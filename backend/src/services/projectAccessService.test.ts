jest.mock('../repositories/projectAccessRepository', () => ({
  projectAccessRepository: {
    listForProject: jest.fn(), findBySubject: jest.fn(),
    create: jest.fn(), updateRole: jest.fn(), remove: jest.fn(),
  },
}));
jest.mock('./logger', () => ({
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('./logger'),
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { projectAccessService } from './projectAccessService';
import { projectAccessRepository } from '../repositories/projectAccessRepository';
import { ROLE_ADMIN, ROLE_EDITOR, ROLE_VIEWER } from '../authz/roles';

const repo = projectAccessRepository as unknown as Record<string, jest.Mock>;

const grantOf = (id: string, roleKey: string, subjectId = 's1') => ({
  $id: id, projectId: 'p1', subject_type: 'user', subject_id: subjectId,
  role_key: roleKey, granted_by: 'admin', granted_at: '2026-01-01T00:00:00.000Z',
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const fn of Object.values(repo)) fn.mockReset();
  repo.create.mockImplementation(async (g: Record<string, unknown>) => ({ ...g, $id: 'new-grant' }));
  repo.updateRole.mockImplementation(async (id: string, roleKey: string) => grantOf(id, roleKey));
  repo.remove.mockResolvedValue(undefined);
});

describe('grant', () => {
  test('assigns a built-in role and records who did it', async () => {
    const result = await projectAccessService.grant(
      'p1', { subjectType: 'user', subjectId: 'u2', roleKey: ROLE_VIEWER }, 'admin-1',
    );

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1', subject_type: 'user', subject_id: 'u2',
      role_key: ROLE_VIEWER, granted_by: 'admin-1',
    }));
    expect(result).toMatchObject({ $id: 'new-grant' });
  });

  test('refuses a role that is not seeded', async () => {
    // v1 has no custom roles, so an arbitrary role_key would resolve to an
    // empty permission set — a grant that silently gives nothing.
    expect(await projectAccessService.grant(
      'p1', { subjectType: 'user', subjectId: 'u2', roleKey: 'project_god' }, 'admin-1',
    )).toBe('invalid_role');
    expect(repo.create).not.toHaveBeenCalled();
  });

  test('refuses a subject type outside user and team', async () => {
    expect(await projectAccessService.grant(
      'p1', { subjectType: 'everyone', subjectId: 'x', roleKey: ROLE_VIEWER }, 'admin-1',
    )).toBe('invalid_subject_type');
  });

  test('a duplicate grant is reported, not silently overwritten', async () => {
    // Re-POSTing must not quietly replace a role someone deliberately set.
    repo.create.mockRejectedValue({ code: 409 });

    expect(await projectAccessService.grant(
      'p1', { subjectType: 'user', subjectId: 'u2', roleKey: ROLE_ADMIN }, 'admin-1',
    )).toBe('already_granted');
  });
});

describe('changeRole', () => {
  test('downgrades a subject when another admin remains', async () => {
    repo.findBySubject.mockResolvedValue([grantOf('g1', ROLE_ADMIN)]);
    repo.listForProject.mockResolvedValue([grantOf('g1', ROLE_ADMIN), grantOf('g2', ROLE_ADMIN, 's2')]);

    const result = await projectAccessService.changeRole('p1', 's1', ROLE_EDITOR, 'admin-1');

    expect(repo.updateRole).toHaveBeenCalledWith('g1', ROLE_EDITOR, 'admin-1');
    expect(result).toMatchObject({ role_key: ROLE_EDITOR });
  });

  test('refuses to demote the last admin', async () => {
    // Otherwise the project has nobody who can ever grant access to it again,
    // recoverable only by an operator with database credentials.
    repo.findBySubject.mockResolvedValue([grantOf('g1', ROLE_ADMIN)]);
    repo.listForProject.mockResolvedValue([grantOf('g1', ROLE_ADMIN), grantOf('g2', ROLE_VIEWER, 's2')]);

    expect(await projectAccessService.changeRole('p1', 's1', ROLE_VIEWER, 'admin-1')).toBe('last_admin');
    expect(repo.updateRole).not.toHaveBeenCalled();
  });

  test('demoting a non-admin never trips the last-admin guard', async () => {
    repo.findBySubject.mockResolvedValue([grantOf('g1', ROLE_EDITOR)]);

    await projectAccessService.changeRole('p1', 's1', ROLE_VIEWER, 'admin-1');

    expect(repo.updateRole).toHaveBeenCalled();
    expect(repo.listForProject).not.toHaveBeenCalled(); // no need to count admins
  });

  test('setting the role a subject already has is a no-op, so retries are safe', async () => {
    repo.findBySubject.mockResolvedValue([grantOf('g1', ROLE_ADMIN)]);

    await projectAccessService.changeRole('p1', 's1', ROLE_ADMIN, 'admin-1');

    expect(repo.updateRole).not.toHaveBeenCalled();
  });

  test('an ambiguous subject id is refused rather than resolved by guessing', async () => {
    // Picking one would modify the wrong subject.
    repo.findBySubject.mockResolvedValue([grantOf('g1', ROLE_VIEWER), grantOf('g2', ROLE_ADMIN)]);

    expect(await projectAccessService.changeRole('p1', 's1', ROLE_EDITOR, 'admin-1')).toBe('ambiguous_subject');
  });

  test('an unknown subject is not found', async () => {
    repo.findBySubject.mockResolvedValue([]);

    expect(await projectAccessService.changeRole('p1', 'ghost', ROLE_EDITOR, 'admin-1')).toBe('not_found');
  });
});

describe('revoke', () => {
  test('removes a grant when an admin remains', async () => {
    repo.findBySubject.mockResolvedValue([grantOf('g1', ROLE_EDITOR)]);

    expect(await projectAccessService.revoke('p1', 's1', 'admin-1')).toBe('ok');
    expect(repo.remove).toHaveBeenCalledWith('g1');
  });

  test('refuses to revoke the last admin', async () => {
    repo.findBySubject.mockResolvedValue([grantOf('g1', ROLE_ADMIN)]);
    repo.listForProject.mockResolvedValue([grantOf('g1', ROLE_ADMIN)]);

    expect(await projectAccessService.revoke('p1', 's1', 'admin-1')).toBe('last_admin');
    expect(repo.remove).not.toHaveBeenCalled();
  });

  test('an admin may revoke themselves while another admin exists', async () => {
    repo.findBySubject.mockResolvedValue([grantOf('g1', ROLE_ADMIN)]);
    repo.listForProject.mockResolvedValue([grantOf('g1', ROLE_ADMIN), grantOf('g2', ROLE_ADMIN, 's2')]);

    expect(await projectAccessService.revoke('p1', 's1', 's1')).toBe('ok');
  });
});
