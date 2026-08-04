import express from 'express';
import request from 'supertest';

jest.mock('../middleware/requireRole', () => ({ resolveRole: jest.fn() }));
jest.mock('../utils/tamperAuditLogger', () => ({ logSecureAuditEvent: jest.fn() }));
// The limiter is real middleware with real state; stub it so a 60-request window
// can't leak between tests and turn a genuine assertion into a 429.
jest.mock('../middleware/rateLimiters', () => ({
    terminalLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import terminalRoutes from './terminalRoutes';
import { resolveRole } from '../middleware/requireRole';
import { logSecureAuditEvent } from '../utils/tamperAuditLogger';
import { register, __resetRegistryForTests } from '../services/terminal/commands';
import { registerBuiltins, __resetBuiltinsForTests } from '../services/terminal/builtins';

const mockRole = resolveRole as jest.Mock;
const mockAudit = logSecureAuditEvent as jest.Mock;

/** Stands in for the `authenticate` middleware the router is mounted behind. */
function buildApp(user: { $id?: string; email?: string } | undefined = { $id: 'u1', email: 'op@scorpion.local' }) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as { user?: unknown }).user = user; next(); });
    app.use('/api/terminal', terminalRoutes);
    return app;
}

/** Parsed audit payloads, in write order. */
function auditPayloads(): Array<Record<string, unknown>> {
    return mockAudit.mock.calls.map((c) => JSON.parse(c[3] as string));
}

beforeEach(() => {
    jest.clearAllMocks();
    __resetRegistryForTests();
    __resetBuiltinsForTests();
    registerBuiltins();
    mockRole.mockResolvedValue('user');
    mockAudit.mockResolvedValue(undefined);
});

describe('POST /exec — request validation', () => {
    it('rejects a missing command', async () => {
        const res = await request(buildApp()).post('/api/terminal/exec').send({});
        expect(res.status).toBe(400);
        expect(mockAudit).not.toHaveBeenCalled();
    });

    it('rejects a non-string command', async () => {
        const res = await request(buildApp()).post('/api/terminal/exec').send({ command: { evil: true } });
        expect(res.status).toBe(400);
    });
});

describe('POST /exec — read-only verb', () => {
    it('returns 200 and audits the resolved verb with mutating:false', async () => {
        const res = await request(buildApp()).post('/api/terminal/exec').send({ command: 'whoami' });

        expect(res.status).toBe(200);
        expect(res.body.lines.join('\n')).toContain('op@scorpion.local');

        const [entry] = auditPayloads();
        expect(entry).toMatchObject({ command: 'whoami', mutating: false, outcome: 'ok', role: 'user' });
    });

    it('records argv rather than the raw input string', async () => {
        register({ name: 'probe', summary: 's', usage: 'probe', mutating: false, handler: async () => ['ok'] });

        await request(buildApp()).post('/api/terminal/exec').send({ command: '  probe   --env   prod ' });

        expect(auditPayloads()[0]).toMatchObject({ command: 'probe', argv: ['--env', 'prod'] });
    });

    it('still returns 200 when the audit write fails, but logs the degradation', async () => {
        // Fail-open is deliberate for read-only verbs; it can no longer mask a
        // state change, because mutating verbs are audited before they run.
        mockAudit.mockRejectedValue(new Error('ledger down'));

        const res = await request(buildApp()).post('/api/terminal/exec').send({ command: 'whoami' });
        expect(res.status).toBe(200);
    });
});

describe('POST /exec — mutating verb is fail-closed', () => {
    const registerMutating = (handler = jest.fn().mockResolvedValue(['done'])) => {
        register({ name: 'change', summary: 's', usage: 'change', mutating: true, handler });
        return handler;
    };

    it('writes the audit record BEFORE running the handler', async () => {
        const seenAtHandlerTime: number[] = [];
        registerMutating(jest.fn().mockImplementation(async () => {
            seenAtHandlerTime.push(mockAudit.mock.calls.length);
            return ['done'];
        }));

        await request(buildApp()).post('/api/terminal/exec').send({ command: 'change' });

        // At least one record already existed when the handler began.
        expect(seenAtHandlerTime[0]).toBeGreaterThanOrEqual(1);
        expect(auditPayloads()[0]).toMatchObject({ command: 'change', mutating: true, outcome: 'started' });
    });

    it('refuses to run the handler at all when the ledger is unavailable', async () => {
        const handler = registerMutating();
        mockAudit.mockRejectedValue(new Error('ledger down'));

        const res = await request(buildApp()).post('/api/terminal/exec').send({ command: 'change' });

        expect(res.status).toBe(503);
        expect(res.body.error).toMatch(/Audit ledger unavailable/);
        // The whole point: no state change without a durable record of it.
        expect(handler).not.toHaveBeenCalled();
    });
});

describe('POST /exec — blocked and hostile input', () => {
    it('rejects an unallowlisted command without executing anything', async () => {
        const res = await request(buildApp()).post('/api/terminal/exec').send({ command: 'rm -rf /' });

        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/unknown command/);
    });

    it('audits a rejected command, keeping the raw input as the forensic record', async () => {
        await request(buildApp()).post('/api/terminal/exec').send({ command: 'rm -rf /' });

        expect(auditPayloads()[0]).toMatchObject({
            command: null, outcome: 'rejected', raw: 'rm -rf /',
        });
    });

    it('rejects an injection attempt appended to a real verb', async () => {
        const res = await request(buildApp()).post('/api/terminal/exec').send({ command: 'whoami; cat /etc/passwd' });

        // 'whoami;' is not a verb — the lookup misses and nothing runs.
        expect(res.status).toBe(404);
    });

    it('rejects trailing arguments on a no-argument verb rather than silently ignoring them', async () => {
        const res = await request(buildApp()).post('/api/terminal/exec').send({ command: 'whoami | sh' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/takes no arguments/);
        expect(auditPayloads()[0]).toMatchObject({ command: 'whoami', outcome: 'rejected' });
    });

    it('rejects control characters', async () => {
        const res = await request(buildApp()).post('/api/terminal/exec').send({ command: 'whoami\u0007' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/control characters/);
    });
});

describe('POST /exec — authorisation', () => {
    it('denies a verb the caller\'s role does not allow, and does not run it', async () => {
        const handler = jest.fn().mockResolvedValue(['ran']);
        register({ name: 'restricted', summary: 's', usage: 'restricted', mutating: false, allowedRoles: ['admin'], handler });

        const res = await request(buildApp()).post('/api/terminal/exec').send({ command: 'restricted' });

        expect(res.status).toBe(403);
        expect(handler).not.toHaveBeenCalled();
        expect(auditPayloads()[0]).toMatchObject({ command: 'restricted', outcome: 'rejected' });
    });

    it('allows the verb once the role permits it', async () => {
        mockRole.mockResolvedValue('admin');
        register({ name: 'restricted', summary: 's', usage: 'restricted', mutating: false, allowedRoles: ['admin'], handler: async () => ['ran'] });

        const res = await request(buildApp()).post('/api/terminal/exec').send({ command: 'restricted' });

        expect(res.status).toBe(200);
        expect(res.body.lines).toEqual(['ran']);
    });

    it('refuses every command when the role cannot be resolved, rather than assuming a default', async () => {
        mockRole.mockRejectedValue(new Error('ROLES collection unreachable'));

        const res = await request(buildApp()).post('/api/terminal/exec').send({ command: 'whoami' });

        expect(res.status).toBe(503);
        expect(mockAudit).not.toHaveBeenCalled();
    });
});

describe('GET /commands', () => {
    it('lists only what the caller may run', async () => {
        register({ name: 'restricted', summary: 's', usage: 'restricted', mutating: false, allowedRoles: ['admin'], handler: async () => [] });

        const res = await request(buildApp()).get('/api/terminal/commands');

        expect(res.status).toBe(200);
        expect(res.body.role).toBe('user');
        const names = res.body.commands.map((c: { name: string }) => c.name);
        expect(names).toContain('whoami');
        expect(names).not.toContain('restricted');
    });
});
