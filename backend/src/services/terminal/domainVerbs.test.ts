jest.mock('../gateService', () => ({ checkReleaseGate: jest.fn() }));
jest.mock('../tenancyService', () => ({ canAccessResource: jest.fn() }));
jest.mock('../imageStore', () => ({ getProvenance: jest.fn() }));
jest.mock('../../lib/appwrite', () => ({
    databases: { getDocument: jest.fn(), listDocuments: jest.fn() },
    DB_ID: 'db',
    COLLECTIONS: { REPOSITORIES: 'repositories' },
    Query: {
        orderDesc: (f: string) => `orderDesc(${f})`,
        limit: (n: number) => `limit(${n})`,
        equal: (f: string, v: unknown) => `equal(${f},${JSON.stringify(v)})`,
    },
}));

import { dispatch, CommandError, __resetRegistryForTests, type TerminalContext } from './commands';
import { registerDomainVerbs, __resetDomainVerbsForTests } from './domainVerbs';
import { checkReleaseGate } from '../gateService';
import { canAccessResource } from '../tenancyService';
import { getProvenance } from '../imageStore';
import { databases } from '../../lib/appwrite';

const mockGate = checkReleaseGate as jest.Mock;
const mockAccess = canAccessResource as jest.Mock;
const mockProv = getProvenance as jest.Mock;
const mockGetDoc = databases.getDocument as jest.Mock;
const mockList = databases.listDocuments as jest.Mock;

const user: TerminalContext = { userId: 'u1', email: 'op@scorpion.local', role: 'user' };
const admin: TerminalContext = { userId: 'u2', email: 'admin@scorpion.local', role: 'admin' };

beforeEach(() => {
    jest.clearAllMocks();
    __resetRegistryForTests();
    __resetDomainVerbsForTests();
    registerDomainVerbs();

    mockGetDoc.mockResolvedValue({ $id: 'repo1', user_id: 'u1' });
    mockAccess.mockResolvedValue(true);
});

describe('gate status', () => {
    const passing = { allowed: true, score: 95, blocker_count: 0, blockers: [], minSecurityScore: 80 };

    it('reports the verdict, score and blocker count', async () => {
        mockGate.mockResolvedValue(passing);

        const { lines } = await dispatch('gate status repo1', user);

        expect(lines.join('\n')).toContain('verdict:   PASSING');
        expect(lines.join('\n')).toContain('score:     95% (minimum 80%)');
    });

    it('lists blockers when the gate is blocked', async () => {
        mockGate.mockResolvedValue({
            allowed: false, score: 40, blocker_count: 1, minSecurityScore: 80,
            blockers: [{ $id: 'f1', severity: 'critical', title: 'RCE in parser', packageName: 'left-pad' }],
        });

        const { lines } = await dispatch('gate status repo1', user);
        const text = lines.join('\n');

        expect(text).toContain('verdict:   BLOCKED');
        expect(text).toContain('CRITICAL');
        expect(text).toContain('RCE in parser');
        expect(text).toContain('left-pad');
    });

    it('refuses a repo the caller cannot access, and never evaluates the gate', async () => {
        mockAccess.mockResolvedValue(false);

        await expect(dispatch('gate status someoneElsesRepo', user)).rejects.toThrow(/no accessible repository/);
        expect(mockGate).not.toHaveBeenCalled();
    });

    it('gives the same answer for a nonexistent repo as for a forbidden one', async () => {
        // Distinguishing the two would turn the verb into a membership oracle
        // for repo ids.
        mockGetDoc.mockRejectedValue(new Error('not found'));
        const missing = await dispatch('gate status nope', user).catch((e: CommandError) => e);

        mockGetDoc.mockResolvedValue({ $id: 'other' });
        mockAccess.mockResolvedValue(false);
        const forbidden = await dispatch('gate status other', user).catch((e: CommandError) => e);

        expect((missing as CommandError).status).toBe((forbidden as CommandError).status);
        expect((missing as CommandError).message.replace('nope', 'X'))
            .toBe((forbidden as CommandError).message.replace('other', 'X'));
    });

    it('rejects a missing subcommand or repoId', async () => {
        await expect(dispatch('gate', user)).rejects.toThrow(/usage: gate status/);
        await expect(dispatch('gate status', user)).rejects.toThrow(/missing <repoId>/);
    });
});

describe('pipeline ls', () => {
    it('scopes to the caller\'s own repos when no repoId is given', async () => {
        mockList
            .mockResolvedValueOnce({ documents: [{ $id: 'repo1' }, { $id: 'repo2' }] })
            .mockResolvedValueOnce({ documents: [] });

        await dispatch('pipeline ls', user);

        // The run query must be constrained to the accessible ids, not unfiltered.
        const runQuery = mockList.mock.calls[1][2] as string[];
        expect(runQuery.some((q) => q.includes('repo1') && q.includes('repo2'))).toBe(true);
    });

    it('says so plainly when the caller owns no repos, without querying runs', async () => {
        mockList.mockResolvedValueOnce({ documents: [] });

        const { lines } = await dispatch('pipeline ls', user);

        expect(lines.join('\n')).toMatch(/No repositories accessible/);
        expect(mockList).toHaveBeenCalledTimes(1);
    });

    it('renders runs with a truncated commit sha', async () => {
        mockList.mockResolvedValueOnce({
            documents: [{ $id: 'run-1', repoId: 'repo1', status: 'success', commitSha: 'abcdef1234567890' }],
        });

        const { lines } = await dispatch('pipeline ls repo1', user);
        const text = lines.join('\n');

        expect(text).toContain('run-1');
        expect(text).toContain('success');
        expect(text).toContain('abcdef12');
        expect(text).not.toContain('abcdef1234567890');
    });

    it('refuses an inaccessible repoId before listing anything', async () => {
        mockAccess.mockResolvedValue(false);

        await expect(dispatch('pipeline ls otherRepo', user)).rejects.toThrow(/no accessible repository/);
        expect(mockList).not.toHaveBeenCalled();
    });
});

describe('provenance show', () => {
    const statement = JSON.stringify({
        predicateType: 'https://slsa.dev/provenance/v1',
        subject: [{ name: 'ghcr.io/x/y' }],
        predicate: { buildType: 'github-actions', builder: { id: 'scorpion' }, metadata: { buildStartedOn: '2026-08-04T00:00:00Z' } },
    });

    it('is admin-only', async () => {
        await expect(dispatch('provenance show sha256:abc', user)).rejects.toThrow(/requires role admin/);
        expect(mockProv).not.toHaveBeenCalled();
    });

    it('renders parsed fields rather than raw JSON', async () => {
        mockProv.mockResolvedValue(statement);

        const { lines } = await dispatch('provenance show sha256:abc', admin);
        const text = lines.join('\n');

        expect(text).toContain('predicate: https://slsa.dev/provenance/v1');
        expect(text).toContain('buildType: github-actions');
        expect(text).toContain('ghcr.io/x/y');
    });

    it('distinguishes absent provenance from unattested, rather than implying the latter', async () => {
        mockProv.mockResolvedValue(undefined);

        const { lines } = await dispatch('provenance show sha256:abc', admin);

        expect(lines.join('\n')).toMatch(/Absence is not evidence the image is unattested/);
    });

    it('treats unparseable stored provenance as a finding, not as absent', async () => {
        mockProv.mockResolvedValue('{not json');

        await expect(dispatch('provenance show sha256:abc', admin)).rejects.toThrow(/not valid JSON/);
    });

    it('rejects a missing digest', async () => {
        await expect(dispatch('provenance show', admin)).rejects.toThrow(/missing <digest>/);
    });
});

describe('registry contract', () => {
    it('registers every domain verb as non-mutating', async () => {
        // If one of these ever becomes mutating, the route audits it before the
        // handler runs and refuses when the ledger is down. This asserts the
        // current, deliberate state so that flip is a visible change.
        mockGate.mockResolvedValue({ allowed: true, score: 100, blocker_count: 0, blockers: [], minSecurityScore: 80 });
        const result = await dispatch('gate status repo1', user);
        expect(result.mutating).toBe(false);
    });

    it('is idempotent, so a re-import cannot duplicate-register', () => {
        expect(() => registerDomainVerbs()).not.toThrow();
    });
});
