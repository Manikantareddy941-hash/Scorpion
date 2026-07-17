// openid-client ships an ESM entry jest can't parse; the functions under
// test (provisioning, token minting, config check) never touch it.
jest.mock('openid-client', () => ({}));
jest.mock('../lib/appwrite', () => ({
    users: { list: jest.fn(), create: jest.fn(), createToken: jest.fn() },
    ID: { unique: () => 'new-id' },
    Query: { equal: jest.fn((f: string, v: string) => `${f}=${v}`) }
}));

import { provisionSsoUser, issueSessionToken, isSsoConfigured } from './oidcService';
import { users } from '../lib/appwrite';

const list = users.list as jest.Mock;
const create = users.create as jest.Mock;
const createToken = users.createToken as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('provisionSsoUser', () => {
    it('returns the existing user on repeat login', async () => {
        list.mockResolvedValue({ total: 1, users: [{ $id: 'u-1' }] });

        const id = await provisionSsoUser({ email: 'jo@corp.com', name: 'Jo' });

        expect(id).toBe('u-1');
        expect(create).not.toHaveBeenCalled();
    });

    it('creates the user on first login (JIT provisioning)', async () => {
        list.mockResolvedValue({ total: 0, users: [] });
        create.mockResolvedValue({ $id: 'new-id' });

        const id = await provisionSsoUser({ email: 'new@corp.com', name: 'New' });

        expect(id).toBe('new-id');
        expect(create).toHaveBeenCalledWith('new-id', 'new@corp.com', undefined, undefined, 'New');
    });
});

describe('issueSessionToken', () => {
    it('mints an Appwrite custom token for the user', async () => {
        createToken.mockResolvedValue({ secret: 'tok-secret' });

        const token = await issueSessionToken('u-1');

        expect(token).toEqual({ userId: 'u-1', secret: 'tok-secret' });
    });
});

describe('isSsoConfigured', () => {
    const saved = { ...process.env };
    afterEach(() => { process.env = { ...saved }; });

    it('requires issuer, client id and secret', () => {
        delete process.env.OIDC_ISSUER_URL;
        expect(isSsoConfigured()).toBe(false);

        process.env.OIDC_ISSUER_URL = 'https://idp.example.com';
        process.env.OIDC_CLIENT_ID = 'cid';
        process.env.OIDC_CLIENT_SECRET = 'cs';
        expect(isSsoConfigured()).toBe(true);
    });
});
