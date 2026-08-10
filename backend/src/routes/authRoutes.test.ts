import request from 'supertest';
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// Pin a known reset-token secret so sign/verify agree (the route otherwise uses
// a random per-process secret when RESET_TOKEN_SECRET is unset). Read lazily by
// the route at request time, so setting it here is sufficient.
process.env.RESET_TOKEN_SECRET = 'test-reset-secret';

jest.mock('../lib/appwrite', () => ({
    databases: {
        listDocuments: jest.fn(),
        createDocument: jest.fn(),
        updateDocument: jest.fn(),
        deleteDocument: jest.fn(),
    },
    users: {
        list: jest.fn(),
        updatePassword: jest.fn(),
    },
    DB_ID: 'test-db',
    COLLECTIONS: { PASSWORD_RESETS: 'password_resets' },
    Query: { equal: (field: string, value: unknown) => ({ field, value }) },
    ID: { unique: () => 'generated-id' },
}));
jest.mock('../services/emailService', () => ({
    sendOtpEmail: jest.fn().mockResolvedValue(undefined),
}));

import authRoutes from './authRoutes';
import { databases, users } from '../lib/appwrite';
import { sendOtpEmail } from '../services/emailService';

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/auth', authRoutes);
    return app;
};

describe('POST /auth/request-reset', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('rejects requests with no email', async () => {
        const res = await request(buildApp()).post('/auth/request-reset').send({});
        expect(res.statusCode).toBe(400);
    });

    it('creates a new OTP record and emails it when no reset record exists yet', async () => {
        (users.list as jest.Mock).mockResolvedValue({ total: 1, users: [{ $id: 'user-1' }] });
        (databases.listDocuments as jest.Mock).mockResolvedValue({ total: 0, documents: [] });
        (databases.createDocument as jest.Mock).mockResolvedValue({ $id: 'reset-1' });

        const res = await request(buildApp()).post('/auth/request-reset').send({ email: 'a@b.com' });

        expect(res.statusCode).toBe(200);
        expect(databases.createDocument).toHaveBeenCalled();
        expect(sendOtpEmail).toHaveBeenCalledWith('a@b.com', expect.stringMatching(/^\d{6}$/));
    });

    it('updates the existing reset record instead of creating a duplicate', async () => {
        (users.list as jest.Mock).mockResolvedValue({ total: 1, users: [{ $id: 'user-1' }] });
        (databases.listDocuments as jest.Mock).mockResolvedValue({
            total: 1,
            documents: [{ $id: 'existing-reset' }],
        });

        const res = await request(buildApp()).post('/auth/request-reset').send({ email: 'a@b.com' });

        expect(res.statusCode).toBe(200);
        expect(databases.updateDocument).toHaveBeenCalledWith(
            'test-db',
            'password_resets',
            'existing-reset',
            expect.objectContaining({ otp_hash: expect.any(String) })
        );
        expect(databases.createDocument).not.toHaveBeenCalled();
    });
});

describe('POST /auth/verify-otp', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('rejects requests missing email or otp', async () => {
        const res = await request(buildApp()).post('/auth/verify-otp').send({ email: 'a@b.com' });
        expect(res.statusCode).toBe(400);
    });

    it('rejects when no reset record exists', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({ total: 0, documents: [] });
        const res = await request(buildApp()).post('/auth/verify-otp').send({ email: 'a@b.com', otp: '123456' });
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toMatch(/invalid or expired/i);
    });

    it('rejects an expired OTP', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({
            total: 1,
            documents: [{
                $id: 'reset-1',
                otp_hash: await bcrypt.hash('123456', 10),
                expires_at: new Date(Date.now() - 1000).toISOString(),
                attempts: 0,
            }],
        });

        const res = await request(buildApp()).post('/auth/verify-otp').send({ email: 'a@b.com', otp: '123456' });
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toMatch(/expired/i);
    });

    it('rejects after 5 failed attempts', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({
            total: 1,
            documents: [{
                $id: 'reset-1',
                otp_hash: await bcrypt.hash('123456', 10),
                expires_at: new Date(Date.now() + 60_000).toISOString(),
                attempts: 5,
            }],
        });

        const res = await request(buildApp()).post('/auth/verify-otp').send({ email: 'a@b.com', otp: '123456' });
        expect(res.statusCode).toBe(429);
    });

    it('increments attempts and rejects an incorrect OTP', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({
            total: 1,
            documents: [{
                $id: 'reset-1',
                otp_hash: await bcrypt.hash('123456', 10),
                expires_at: new Date(Date.now() + 60_000).toISOString(),
                attempts: 1,
            }],
        });

        const res = await request(buildApp()).post('/auth/verify-otp').send({ email: 'a@b.com', otp: '000000' });

        expect(res.statusCode).toBe(400);
        expect(databases.updateDocument).toHaveBeenCalledWith('test-db', 'password_resets', 'reset-1', { attempts: 2 });
    });

    it('returns a signed reset token for a correct OTP', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({
            total: 1,
            documents: [{
                $id: 'reset-1',
                otp_hash: await bcrypt.hash('123456', 10),
                expires_at: new Date(Date.now() + 60_000).toISOString(),
                attempts: 0,
            }],
        });

        const res = await request(buildApp()).post('/auth/verify-otp').send({ email: 'a@b.com', otp: '123456' });

        expect(res.statusCode).toBe(200);
        expect(res.body.resetToken).toBeTruthy();
        const decoded = jwt.decode(res.body.resetToken) as { email: string };
        expect(decoded.email).toBe('a@b.com');
    });
});

describe('POST /auth/reset-password', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('rejects requests missing resetToken or newPassword', async () => {
        const res = await request(buildApp()).post('/auth/reset-password').send({});
        expect(res.statusCode).toBe(400);
    });

    it('rejects an invalid/garbage reset token', async () => {
        const res = await request(buildApp())
            .post('/auth/reset-password')
            .send({ resetToken: 'not-a-real-token', newPassword: 'NewPass123!' });

        expect(res.statusCode).toBe(401);
    });

    it('updates the password and deletes the reset record for a valid token', async () => {
        const secret = process.env.RESET_TOKEN_SECRET as string;
        // Secret is read from env, not a hardcoded literal — false positive in a test.
        // nosemgrep: javascript.jsonwebtoken.security.jwt-hardcode.hardcoded-jwt-secret
        const resetToken = jwt.sign({ email: 'a@b.com' }, secret, { expiresIn: '5m' });

        (users.list as jest.Mock).mockResolvedValue({ total: 1, users: [{ $id: 'user-1' }] });
        (databases.listDocuments as jest.Mock).mockResolvedValue({
            total: 1,
            documents: [{ $id: 'reset-1' }],
        });

        const res = await request(buildApp())
            .post('/auth/reset-password')
            .send({ resetToken, newPassword: 'NewPass123!' });

        expect(res.statusCode).toBe(200);
        expect(users.updatePassword).toHaveBeenCalledWith('user-1', 'NewPass123!');
        expect(databases.deleteDocument).toHaveBeenCalledWith('test-db', 'password_resets', 'reset-1');
    });

    it('returns 404 when the token is valid but the user no longer exists', async () => {
        const secret = process.env.RESET_TOKEN_SECRET as string;
        // Secret is read from env, not a hardcoded literal — false positive in a test.
        // nosemgrep: javascript.jsonwebtoken.security.jwt-hardcode.hardcoded-jwt-secret
        const resetToken = jwt.sign({ email: 'gone@b.com' }, secret, { expiresIn: '5m' });
        (users.list as jest.Mock).mockResolvedValue({ total: 0, users: [] });

        const res = await request(buildApp())
            .post('/auth/reset-password')
            .send({ resetToken, newPassword: 'NewPass123!' });

        expect(res.statusCode).toBe(404);
    });
});

/**
 * CWE-209 regression guard for the fix in #231. These handlers used to answer
 * 500 with `errorMessage(error)`, putting the raw internal failure — Appwrite
 * text, collection and attribute names, SMTP detail — on an UNAUTHENTICATED
 * endpoint, and letting a prober tell one backend fault from another.
 *
 * Each case asserts the body does NOT CONTAIN the thrown text, not merely that
 * it equals the expected string: an equality-only assertion still passes if
 * someone later appends the detail to the generic message.
 */
describe('500 responses do not leak internal error detail', () => {
    const SECRET_DETAIL = 'Appwrite collection password_resets is missing attribute otp_hash';
    const GENERIC = 'An unexpected error occurred processing your request.';

    beforeEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    it('request-reset answers generically when an unexpected failure escapes', async () => {
        (users.list as jest.Mock).mockResolvedValue({ total: 1, users: [{ $id: 'user-1' }] });
        // Thrown outside the handler's inner try/catches, so it reaches the outer
        // one — the reset flow deliberately swallows store and mail failures
        // outside production.
        jest.spyOn(bcrypt, 'hash').mockRejectedValue(new Error(SECRET_DETAIL) as never);

        const res = await request(buildApp()).post('/auth/request-reset').send({ email: 'a@b.com' });

        expect(res.statusCode).toBe(500);
        expect(res.body.error).toBe(GENERIC);
        expect(JSON.stringify(res.body)).not.toContain(SECRET_DETAIL);
        expect(JSON.stringify(res.body)).not.toContain('password_resets');
    });

    it('verify-otp answers generically when the store read throws', async () => {
        (databases.listDocuments as jest.Mock).mockRejectedValue(new Error(SECRET_DETAIL));

        const res = await request(buildApp())
            .post('/auth/verify-otp')
            .send({ email: 'a@b.com', otp: '123456' });

        expect(res.statusCode).toBe(500);
        expect(res.body.error).toBe(GENERIC);
        expect(JSON.stringify(res.body)).not.toContain(SECRET_DETAIL);
    });

    it('reset-password answers generically when the user lookup throws', async () => {
        const secret = process.env.RESET_TOKEN_SECRET as string;
        // Secret is read from env, not a hardcoded literal — false positive in a test.
        // nosemgrep: javascript.jsonwebtoken.security.jwt-hardcode.hardcoded-jwt-secret
        const resetToken = jwt.sign({ email: 'a@b.com' }, secret, { expiresIn: '5m' });
        (users.list as jest.Mock).mockRejectedValue(new Error(SECRET_DETAIL));

        const res = await request(buildApp())
            .post('/auth/reset-password')
            .send({ resetToken, newPassword: 'NewPass123!' });

        expect(res.statusCode).toBe(500);
        expect(res.body.error).toBe(GENERIC);
        expect(JSON.stringify(res.body)).not.toContain(SECRET_DETAIL);
    });

    /**
     * The 401 is a deliberate exception and must stay specific: it describes the
     * caller's OWN token, not anything internal, and collapsing it into the
     * generic 500 would lose a distinction the client legitimately needs.
     */
    it('still answers an invalid token with a specific 401, not a generic 500', async () => {
        const res = await request(buildApp())
            .post('/auth/reset-password')
            .send({ resetToken: 'garbage', newPassword: 'NewPass123!' });

        expect(res.statusCode).toBe(401);
        expect(res.body.error).toBe('Invalid or expired reset token');
    });
});
