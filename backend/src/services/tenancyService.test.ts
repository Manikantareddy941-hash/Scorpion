jest.mock('../lib/appwrite', () => ({
    databases: {
        listDocuments: jest.fn(),
        getDocument: jest.fn(),
    },
    DB_ID: 'test-db',
    COLLECTIONS: { TEAM_MEMBERS: 'team_members', REPOSITORIES: 'repositories' },
    Query: { equal: (field: string, value: unknown) => ({ field, value }), limit: (n: number) => ({ limit: n }) },
}));

import { databases } from '../lib/appwrite';
import {
    canAccessResource,
    isTeamMember,
    resolveOwnershipScope,
    resolveCreationOwnership,
    assertRepoAccess,
    TenantAccessError,
    ACTIVE_TEAM_HEADER,
} from './tenancyService';

describe('canAccessResource', () => {
    beforeEach(() => jest.clearAllMocks());

    it('grants access when the resource is directly owned by the user', async () => {
        await expect(canAccessResource({ user_id: 'user-1' }, 'user-1')).resolves.toBe(true);
    });

    it('denies access when neither user_id nor team_id match', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({ total: 0 });
        await expect(canAccessResource({ user_id: 'someone-else' }, 'user-1')).resolves.toBe(false);
    });

    it('denies access when userId is undefined', async () => {
        await expect(canAccessResource({ user_id: 'user-1' }, undefined)).resolves.toBe(false);
    });

    it('grants access via team membership when user_id does not match', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({ total: 1 });
        await expect(canAccessResource({ user_id: 'owner', team_id: 'team-1' }, 'member-1')).resolves.toBe(true);
        expect(databases.listDocuments).toHaveBeenCalledWith('test-db', 'team_members', [
            { field: 'team_id', value: 'team-1' },
            { field: 'user_id', value: 'member-1' },
            { limit: 1 },
        ]);
    });

    it('denies access via team when the user is not a member', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({ total: 0 });
        await expect(canAccessResource({ user_id: 'owner', team_id: 'team-1' }, 'not-a-member')).resolves.toBe(false);
    });

    it('isTeamMember fails closed (false) if the membership lookup throws', async () => {
        (databases.listDocuments as jest.Mock).mockRejectedValue(new Error('boom'));
        await expect(isTeamMember('team-1', 'user-1')).resolves.toBe(false);
    });
});

describe('resolveOwnershipScope', () => {
    beforeEach(() => jest.clearAllMocks());

    it('defaults to user_id scope when no active-team header is sent', async () => {
        const req = { headers: {} } as any;
        await expect(resolveOwnershipScope(req, 'user-1')).resolves.toEqual({ field: 'user_id', value: 'user-1' });
    });

    it('resolves to team_id scope when the caller is a verified member', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({ total: 1 });
        const req = { headers: { [ACTIVE_TEAM_HEADER]: 'team-1' } } as any;
        await expect(resolveOwnershipScope(req, 'user-1')).resolves.toEqual({ field: 'team_id', value: 'team-1' });
    });

    it('throws TenantAccessError when the active-team header names a team the caller is not in', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({ total: 0 });
        const req = { headers: { [ACTIVE_TEAM_HEADER]: 'team-1' } } as any;
        await expect(resolveOwnershipScope(req, 'user-1')).rejects.toThrow(TenantAccessError);
    });
});

describe('resolveCreationOwnership', () => {
    beforeEach(() => jest.clearAllMocks());

    it('stamps user_id only, team_id null, with no active-team header', async () => {
        const req = { headers: {} } as any;
        await expect(resolveCreationOwnership(req, 'user-1')).resolves.toEqual({ user_id: 'user-1', team_id: null });
    });

    it('stamps both user_id and team_id when an active team is verified', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({ total: 1 });
        const req = { headers: { [ACTIVE_TEAM_HEADER]: 'team-1' } } as any;
        await expect(resolveCreationOwnership(req, 'user-1')).resolves.toEqual({ user_id: 'user-1', team_id: 'team-1' });
    });
});

describe('assertRepoAccess', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns the repo when the caller owns it', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'repo-1', user_id: 'user-1' });
        await expect(assertRepoAccess('repo-1', 'user-1')).resolves.toEqual({ $id: 'repo-1', user_id: 'user-1' });
    });

    it('throws TenantAccessError when the caller does not own the repo', async () => {
        (databases.getDocument as jest.Mock).mockResolvedValue({ $id: 'repo-1', user_id: 'someone-else' });
        await expect(assertRepoAccess('repo-1', 'user-1')).rejects.toThrow(TenantAccessError);
    });

    it('throws TenantAccessError when the repo does not exist', async () => {
        (databases.getDocument as jest.Mock).mockRejectedValue(new Error('not found'));
        await expect(assertRepoAccess('missing', 'user-1')).rejects.toThrow(TenantAccessError);
    });
});
