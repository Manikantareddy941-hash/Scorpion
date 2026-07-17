jest.mock('../services/oidcService', () => ({
    isSsoConfigured: jest.fn(),
    buildLoginRedirect: jest.fn(),
    completeLogin: jest.fn(),
    provisionSsoUser: jest.fn(),
    issueSessionToken: jest.fn()
}));
jest.mock('../services/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

import express from 'express';
import request from 'supertest';
import ssoRoutes from './ssoRoutes';
import {
    isSsoConfigured,
    buildLoginRedirect,
    completeLogin,
    provisionSsoUser,
    issueSessionToken
} from '../services/oidcService';

const app = express();
app.use('/auth/sso', ssoRoutes);

const configured = isSsoConfigured as jest.Mock;
const buildRedirect = buildLoginRedirect as jest.Mock;
const complete = completeLogin as jest.Mock;
const provision = provisionSsoUser as jest.Mock;
const issueToken = issueSessionToken as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    process.env.FRONTEND_URL = 'https://app.example.com';
});

describe('GET /auth/sso/login', () => {
    it('503s when SSO is not configured', async () => {
        configured.mockReturnValue(false);
        const res = await request(app).get('/auth/sso/login');
        expect(res.status).toBe(503);
    });

    it('redirects to the IdP and pins state/nonce/verifier in httpOnly cookies', async () => {
        configured.mockReturnValue(true);
        buildRedirect.mockResolvedValue({
            url: 'https://idp.example.com/authorize?x=1',
            state: 'st',
            nonce: 'no',
            codeVerifier: 'cv'
        });

        const res = await request(app).get('/auth/sso/login');

        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('https://idp.example.com/authorize?x=1');
        const cookies = res.headers['set-cookie'] as unknown as string[];
        expect(cookies.join(';')).toContain('sso_state=st');
        expect(cookies.join(';')).toContain('HttpOnly');
    });
});

describe('GET /auth/sso/callback', () => {
    it('redirects to login with an error when the state cookies are missing', async () => {
        configured.mockReturnValue(true);

        const res = await request(app).get('/auth/sso/callback?code=abc&state=st');

        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('https://app.example.com/login?error=sso_expired');
        expect(complete).not.toHaveBeenCalled();
    });

    it('completes the exchange and hands the frontend a session token in the fragment', async () => {
        configured.mockReturnValue(true);
        complete.mockResolvedValue({ email: 'jo@corp.com', name: 'Jo' });
        provision.mockResolvedValue('user-9');
        issueToken.mockResolvedValue({ userId: 'user-9', secret: 's3cret' });

        const res = await request(app)
            .get('/auth/sso/callback?code=abc&state=st')
            .set('Cookie', ['sso_state=st', 'sso_nonce=no', 'sso_verifier=cv']);

        expect(res.status).toBe(302);
        expect(res.headers.location).toBe(
            'https://app.example.com/auth/callback?userId=user-9&secret=s3cret'
        );
        expect(complete).toHaveBeenCalledWith(expect.any(URL), {
            state: 'st',
            nonce: 'no',
            codeVerifier: 'cv'
        });
    });

    it('redirects to login with an error when the code exchange fails', async () => {
        configured.mockReturnValue(true);
        complete.mockRejectedValue(new Error('bad code'));

        const res = await request(app)
            .get('/auth/sso/callback?code=abc&state=st')
            .set('Cookie', ['sso_state=st', 'sso_nonce=no', 'sso_verifier=cv']);

        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('https://app.example.com/login?error=sso_failed');
    });
});
