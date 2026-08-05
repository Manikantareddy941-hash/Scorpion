import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';

/**
 * Role and auth are mocked per-test via these switches so the same mounted app can
 * exercise the guard chain. Mocking them away entirely — as the other route suites
 * do — would leave the guards on this endpoint untested, and they are the reason it
 * is safe to expose tamper state over HTTP at all.
 */
const guard = { authed: true, role: 'admin' };

jest.mock('../middleware/auth', () => ({
    verifyUser: (_req: Request, res: Response, next: NextFunction) =>
        guard.authed ? next() : res.status(401).json({ error: 'Authentication required' }),
}));
jest.mock('../middleware/requireRole', () => ({
    requireRole: (...allowed: string[]) => (_req: Request, res: Response, next: NextFunction) =>
        allowed.includes(guard.role) ? next() : res.status(403).json({ error: 'Forbidden: insufficient role' }),
}));
jest.mock('../utils/auditOrchestrator', () => ({
    runFullAuditVerification: jest.fn(),
    isTamperSuspected: jest.requireActual('../utils/auditOrchestrator').isTamperSuspected,
}));
jest.mock('../lib/appwrite', () => ({
    databases: { listDocuments: jest.fn(), createDocument: jest.fn() },
    DB_ID: 'test-db', Query: { equal: jest.fn(), orderDesc: jest.fn(), limit: jest.fn() }, ID: { unique: () => 'x' },
}));
jest.mock('../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import auditRoutes from './auditRoutes';
import { runFullAuditVerification } from '../utils/auditOrchestrator';
import { logger } from '../services/logger';

const mockRun = runFullAuditVerification as jest.Mock;

const app = express();
// Honour X-Forwarded-For so each test can occupy its own rate-limit bucket. The
// limiter is deliberately NOT mocked: it is a security control on an endpoint that
// pages the entire ledger, and mocking it would leave the one guard that bounds
// that cost untested. Without per-test IPs the suite exhausts its own five-request
// budget and every later case sees 429 — which is how this was found.
app.set('trust proxy', true);
app.use(express.json());
app.use('/api/audit', auditRoutes);

let ipCounter = 0;
/** A fresh caller IP, so one test's requests never consume another's budget. */
const from = () => `10.0.${Math.floor(ipCounter / 256)}.${ipCounter++ % 256}`;
const get = () => request(app).get('/api/audit/verify').set('X-Forwarded-For', from());

const report = (dbValid = true, anchorStatus = 'MATCH') => ({
    db: { isValid: dbValid, rowsChecked: 12, latestSequence: 11, legacyRows: 0, errors: dbValid ? [] : [{ kind: 'BROKEN_LINK', recordId: 'doc-3', detail: 'x' }], samples: [] },
    anchor: { status: anchorStatus, verified: anchorStatus === 'MATCH', lokiConfigured: true, checked: 1, checks: [] },
    timestamp: '2026-08-04T00:00:00.000Z',
});

beforeEach(() => {
    jest.clearAllMocks();
    guard.authed = true;
    guard.role = 'admin';
    mockRun.mockResolvedValue(report());
});

describe('GET /api/audit/verify — guards', () => {
    it('401s an unauthenticated caller', async () => {
        guard.authed = false;
        await get().expect(401);
        expect(mockRun).not.toHaveBeenCalled();
    });

    it('403s an ordinary authenticated user', async () => {
        // The response says whether the audit ledger has been tampered with, which
        // is precisely what an attacker who just rewrote it wants to read.
        guard.role = 'developer';
        await get().expect(403);
        expect(mockRun).not.toHaveBeenCalled();
    });

    it('allows admin', async () => {
        await get().expect(200);
    });

    it('allows the security role too, matching every other security surface', async () => {
        // drift, falco, netpol, posture and soar all use requireRole('admin','security').
        // The security role is who investigates a tamper report.
        guard.role = 'security';
        await get().expect(200);
    });

    it('refuses before doing any work — the guard runs ahead of the ledger paging', async () => {
        guard.role = 'developer';
        await get().expect(403);
        // Ordering matters: one call pages the entire ledger. If the guard ran after,
        // an unauthorised request would still cost a full database scan.
        expect(mockRun).not.toHaveBeenCalled();
    });
});

describe('GET /api/audit/verify — verdict signalling', () => {
    it('returns 200 and X-Audit-Status: OK for an intact ledger', async () => {
        const res = await get().expect(200);
        expect(res.headers['x-audit-status']).toBe('OK');
        expect(res.body.db.isValid).toBe(true);
    });

    it('flags TAMPER_DETECTED when the chain is internally broken', async () => {
        mockRun.mockResolvedValue(report(false, 'MATCH'));
        const res = await get().expect(200);
        expect(res.headers['x-audit-status']).toBe('TAMPER_DETECTED');
    });

    it('flags TAMPER_DETECTED when a valid chain contradicts the anchor', async () => {
        // The case the internal verifier cannot see on its own.
        mockRun.mockResolvedValue(report(true, 'ANCHOR_MISMATCH'));
        const res = await get().expect(200);
        expect(res.headers['x-audit-status']).toBe('TAMPER_DETECTED');
    });

    it('does NOT flag tampering for a missing anchor', async () => {
        // Loki retention is not an attack, and a flag that fires on log rotation
        // gets muted before it ever catches anything.
        mockRun.mockResolvedValue(report(true, 'ANCHOR_MISSING'));
        const res = await get().expect(200);
        expect(res.headers['x-audit-status']).toBe('OK');
    });

    it('logs at error level on suspicion, so it is not filtered with routine noise', async () => {
        mockRun.mockResolvedValue(report(true, 'ANCHOR_MISMATCH'));
        await get();
        expect((logger.error as jest.Mock).mock.calls[0][0]).toMatch(/integrity check FAILED/);
    });

    it('still returns 200 when tampering is found — the verification succeeded', async () => {
        // A non-2xx would make "the ledger was rewritten" indistinguishable from
        // "the verifier could not run", which are opposite operational situations.
        mockRun.mockResolvedValue(report(false, 'ANCHOR_MISMATCH'));
        await get().expect(200);
    });
});

describe('GET /api/audit/verify — rate limiting', () => {
    it('blocks the sixth request from one caller inside the window', async () => {
        // One call pages the ENTIRE ledger out of Appwrite and then queries Loki, so
        // cost per request grows with the ledger and has no ceiling. Admin auth
        // limits who can reach it; the limiter is what stops an admin session from
        // becoming a database amplifier.
        const ip = '203.0.113.7';
        const hit = () => request(app).get('/api/audit/verify').set('X-Forwarded-For', ip);

        for (let i = 0; i < 5; i++) await hit().expect(200);
        await hit().expect(429);
    });

    it('meters per caller, not globally — one abuser cannot lock out everyone', async () => {
        const abuser = '203.0.113.8';
        for (let i = 0; i < 6; i++) await request(app).get('/api/audit/verify').set('X-Forwarded-For', abuser);

        await get().expect(200);
    });
});

describe('GET /api/audit/verify — when verification cannot run', () => {
    it('500s and says the ledger was NOT verified, rather than implying it is clean', async () => {
        mockRun.mockRejectedValue(new Error('appwrite unreachable'));

        const res = await get().expect(500);

        expect(res.headers['x-audit-status']).toBe('VERIFICATION_FAILED');
        expect(res.body.detail).toMatch(/NOT been verified/);
        // Distinct from TAMPER_DETECTED and from OK: three states, three signals.
        expect(res.headers['x-audit-status']).not.toBe('OK');
    });
});
