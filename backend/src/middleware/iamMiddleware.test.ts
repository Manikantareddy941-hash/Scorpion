import { Request } from 'express';

jest.mock('../lib/appwrite', () => ({
    databases: {
        getDocument: jest.fn(),
        listDocuments: jest.fn(),
    },
    DB_ID: 'test-db',
    COLLECTIONS: { TEAMS: 'teams', TEAM_MEMBERS: 'team_members', REPOSITORIES: 'repositories' },
    Query: {
        equal: (field: string, value: unknown) => ({ equal: [field, value] }),
        limit: (n: number) => ({ limit: n }),
    },
}));

import { databases } from '../lib/appwrite';
import { resolveIamStatements, hasPermission, checkPermission } from './iamMiddleware';
import { DEFAULT_IAM_POLICY, ADMIN_IAM_POLICY } from '../services/policyService';

const fakeReq = (overrides: Partial<Request> = {}) => ({
    headers: {},
    body: {},
    query: {},
    ...overrides,
} as unknown as Request);

describe('resolveIamStatements', () => {
    beforeEach(() => jest.clearAllMocks());

    it('grants full control to the direct owner of a personal (non-team) resource', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'repo-1', user_id: 'user-1' });

        const statements = await resolveIamStatements(fakeReq(), 'user-1', 'repo-1');

        expect(statements).toEqual(ADMIN_IAM_POLICY);
    });

    it('falls back to the default policy for a non-owner with no team context', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'repo-1', user_id: 'someone-else' });

        const statements = await resolveIamStatements(fakeReq(), 'user-1', 'repo-1');

        expect(statements).toEqual(DEFAULT_IAM_POLICY);
    });

    it('falls back to the default policy when resourceId is a wildcard (nothing to check ownership of)', async () => {
        const statements = await resolveIamStatements(fakeReq(), 'user-1', '*');

        expect(statements).toEqual(DEFAULT_IAM_POLICY);
        expect(databases.getDocument).not.toHaveBeenCalled();
    });

    it('always grants full control to the local mock developer', async () => {
        const statements = await resolveIamStatements(fakeReq(), 'mock-local-developer', '*');

        expect(statements).toEqual(ADMIN_IAM_POLICY);
    });

    it('grants full control to an admin-role team member', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'team-1', policy: null });
        (databases.listDocuments as jest.Mock).mockResolvedValue({
            total: 1,
            documents: [{ role: 'admin' }],
        });

        const req = fakeReq({ headers: { 'x-active-team-id': 'team-1' } as any });
        const statements = await resolveIamStatements(req, 'user-1', 'repo-1');

        expect(statements).toEqual(ADMIN_IAM_POLICY);
    });

    it('grants only the default policy to a developer-role team member', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'team-1', policy: null });
        (databases.listDocuments as jest.Mock).mockResolvedValue({
            total: 1,
            documents: [{ role: 'developer' }],
        });

        const req = fakeReq({ headers: { 'x-active-team-id': 'team-1' } as any });
        const statements = await resolveIamStatements(req, 'user-1', 'repo-1');

        expect(statements).toEqual(DEFAULT_IAM_POLICY);
    });

    it('throws when the caller is not a member of the specified team', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'team-1', policy: null });
        (databases.listDocuments as jest.Mock).mockResolvedValue({ total: 0, documents: [] });

        const req = fakeReq({ headers: { 'x-active-team-id': 'team-1' } as any });
        await expect(resolveIamStatements(req, 'user-1', 'repo-1')).rejects.toThrow('Not a member of team team-1');
    });

    // The two cases below are the fail-closed halves of the same rule: an
    // authorization decision that could not be made is not an authorization
    // decision that succeeded. Both previously resolved to a *policy* — the
    // unparseable case to ADMIN_IAM_POLICY for an admin/owner, which meant a
    // corrupt policy blob granted strictly more than the real policy it replaced.
    it('DENIES rather than granting the role default when the team policy is unparseable', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'team-1', policy: '{"Statement": [' });
        (databases.listDocuments as jest.Mock).mockResolvedValue({
            total: 1,
            documents: [{ role: 'owner' }],
        });

        const req = fakeReq({ headers: { 'x-active-team-id': 'team-1' } as any });
        await expect(resolveIamStatements(req, 'user-1', 'repo-1')).rejects.toThrow(/could not be parsed/);
    });

    it('DENIES rather than falling back to DEFAULT_IAM_POLICY when the policy store is unreachable', async () => {
        (databases.getDocument as jest.Mock).mockRejectedValue(new Error('appwrite unreachable'));

        const req = fakeReq({ headers: { 'x-active-team-id': 'team-1' } as any });
        await expect(resolveIamStatements(req, 'user-1', 'repo-1')).rejects.toThrow(/could not be retrieved/);
    });

    it('does not leak an admin grant through hasPermission when the policy store is unreachable', async () => {
        (databases.getDocument as jest.Mock).mockRejectedValue(new Error('appwrite unreachable'));

        const req = fakeReq({ headers: { 'x-active-team-id': 'team-1' } as any });
        // Rejecting (not resolving false) is the point: a caller that forgets to
        // handle the throw gets a 500 from its route handler, which is still a
        // deny. Resolving false would be fine too; resolving true never is.
        await expect(hasPermission(req, 'user-1', 'repo:deploy', 'repo-1')).rejects.toThrow(/could not be retrieved/);
    });
});

describe('hasPermission', () => {
    beforeEach(() => jest.clearAllMocks());

    it('denies repo:deploy for a non-owner with no team context (DEFAULT_IAM_POLICY has no such Allow)', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'repo-1', user_id: 'someone-else' });

        const allowed = await hasPermission(fakeReq(), 'user-1', 'repo:deploy', 'repo-1');

        expect(allowed).toBe(false);
    });

    it('allows repo:deploy for the personal owner of the resource', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'repo-1', user_id: 'user-1' });

        const allowed = await hasPermission(fakeReq(), 'user-1', 'repo:deploy', 'repo-1');

        expect(allowed).toBe(true);
    });
});

describe('checkPermission middleware', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns 401 when there is no authenticated user', async () => {
        const req = fakeReq({ params: {} } as any);
        (req as any).user = undefined;
        const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        await checkPermission('repo:deploy')(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('calls next() when the resolved policy allows the action', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'repo-1', user_id: 'user-1' });
        const req = fakeReq({ params: { id: 'repo-1' } } as any);
        (req as any).user = { $id: 'user-1' };
        const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        await checkPermission('repo:deploy')(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 403 when the resolved policy denies the action', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'repo-1', user_id: 'someone-else' });
        const req = fakeReq({ params: { id: 'repo-1' } } as any);
        (req as any).user = { $id: 'user-1' };
        const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        await checkPermission('repo:deploy')(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });
});
