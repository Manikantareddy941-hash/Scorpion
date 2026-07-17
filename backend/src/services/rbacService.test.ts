/**
 * rbacService: effective-role resolution (direct owner vs team-based with
 * highest-role-wins), role threshold checks, and audit logging that never
 * throws back into the caller.
 */

jest.mock('../lib/appwrite', () => ({
  databases: {
    getDocument: jest.fn(),
    listDocuments: jest.fn(),
    createDocument: jest.fn(),
  },
  DB_ID: 'test-db',
  COLLECTIONS: {
    REPOSITORIES: 'repositories',
    TEAM_MEMBERS: 'team_members',
    PROJECT_ACCESS: 'project_access',
    RBAC_AUDIT_LOGS: 'rbac_audit_logs',
  },
  ID: { unique: () => 'unique-id' },
  Query: {
    equal: (f: string, v: unknown) => ({ equal: [f, v] }),
  },
}));
jest.mock('./logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { getUserEffectiveRole, hasRequiredRole, logRbacAction } from './rbacService';
import { databases } from '../lib/appwrite';

const db = databases as jest.Mocked<typeof databases>;

beforeEach(() => jest.clearAllMocks());

describe('getUserEffectiveRole', () => {
  it('returns owner for the repo owner without team lookups', async () => {
    db.getDocument.mockResolvedValue({ $id: 'r1', user_id: 'user-1' } as never);

    expect(await getUserEffectiveRole('user-1', 'r1')).toBe('owner');
    expect(db.listDocuments).not.toHaveBeenCalled();
  });

  it('returns null when the user has no team memberships', async () => {
    db.getDocument.mockResolvedValue({ $id: 'r1', user_id: 'someone-else' } as never);
    db.listDocuments.mockResolvedValue({ total: 0, documents: [] } as never);

    expect(await getUserEffectiveRole('user-1', 'r1')).toBeNull();
  });

  it('returns null when no team with access exists', async () => {
    db.getDocument.mockResolvedValue({ $id: 'r1', user_id: 'someone-else' } as never);
    db.listDocuments.mockImplementation(async (_d: string, col: string) => {
      if (col === 'team_members') return { total: 1, documents: [{ team_id: 't1', role: 'admin' }] } as never;
      return { total: 0, documents: [] } as never; // project_access empty
    });

    expect(await getUserEffectiveRole('user-1', 'r1')).toBeNull();
  });

  it('returns the highest role across teams that have access', async () => {
    db.getDocument.mockResolvedValue({ $id: 'r1', user_id: 'someone-else' } as never);
    db.listDocuments.mockImplementation(async (_d: string, col: string) => {
      if (col === 'team_members') {
        return {
          total: 3,
          documents: [
            { team_id: 't-viewer', role: 'viewer' },
            { team_id: 't-admin', role: 'admin' },
            { team_id: 't-no-access', role: 'owner' },
          ],
        } as never;
      }
      // only t-viewer and t-admin have access to this repo
      return { total: 2, documents: [{ team_id: 't-viewer' }, { team_id: 't-admin' }] } as never;
    });

    expect(await getUserEffectiveRole('user-1', 'r1')).toBe('admin');
  });

  it('fails closed (null) on lookup errors', async () => {
    db.getDocument.mockRejectedValue(new Error('down'));
    expect(await getUserEffectiveRole('user-1', 'r1')).toBeNull();
  });
});

describe('hasRequiredRole', () => {
  it('enforces the role hierarchy', async () => {
    db.getDocument.mockResolvedValue({ $id: 'r1', user_id: 'user-1' } as never);
    expect(await hasRequiredRole('user-1', 'r1', 'admin')).toBe(true); // owner >= admin

    db.getDocument.mockResolvedValue({ $id: 'r1', user_id: 'other' } as never);
    db.listDocuments.mockImplementation(async (_d: string, col: string) => {
      if (col === 'team_members') return { total: 1, documents: [{ team_id: 't1', role: 'viewer' }] } as never;
      return { total: 1, documents: [{ team_id: 't1' }] } as never;
    });
    expect(await hasRequiredRole('user-1', 'r1', 'viewer')).toBe(true);
    expect(await hasRequiredRole('user-1', 'r1', 'developer')).toBe(false);
  });

  it('denies when no role resolves', async () => {
    db.getDocument.mockRejectedValue(new Error('missing'));
    expect(await hasRequiredRole('user-1', 'r1', 'viewer')).toBe(false);
  });
});

describe('logRbacAction', () => {
  it('persists the action with serialized details', async () => {
    db.createDocument.mockResolvedValue({} as never);

    await logRbacAction({ action: 'role_granted', actor_id: 'admin-1', team_id: 't1', details: { role: 'developer' } });

    expect(db.createDocument).toHaveBeenCalledWith(
      'test-db', 'rbac_audit_logs', 'unique-id',
      expect.objectContaining({ action: 'role_granted', details: JSON.stringify({ role: 'developer' }) }),
    );
  });

  it('swallows audit write failures', async () => {
    db.createDocument.mockRejectedValue(new Error('down'));
    await expect(logRbacAction({ action: 'x', actor_id: 'a' })).resolves.toBeUndefined();
  });
});
