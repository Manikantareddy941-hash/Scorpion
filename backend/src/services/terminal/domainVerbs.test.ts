jest.mock('../gateService', () => ({ checkReleaseGate: jest.fn() }));
jest.mock('../tenancyService', () => ({ canAccessResource: jest.fn() }));
jest.mock('../imageStore', () => ({ getProvenance: jest.fn() }));
// Only the expensive call is stubbed. isTamperSuspected stays real: it decides the
// verdict these tests assert on, and a mocked predicate would be the test agreeing
// with itself.
jest.mock('../../utils/auditOrchestrator', () => ({
    ...jest.requireActual('../../utils/auditOrchestrator'),
    runFullAuditVerification: jest.fn(),
}));
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
import { registerDomainVerbs, __resetDomainVerbsForTests, __resetAuditVerifyCooldownForTests } from './domainVerbs';
import { checkReleaseGate } from '../gateService';
import { canAccessResource } from '../tenancyService';
import { getProvenance } from '../imageStore';
import { runFullAuditVerification } from '../../utils/auditOrchestrator';
import { databases } from '../../lib/appwrite';

const mockGate = checkReleaseGate as jest.Mock;
const mockAccess = canAccessResource as jest.Mock;
const mockProv = getProvenance as jest.Mock;
const mockVerify = runFullAuditVerification as jest.Mock;
const mockGetDoc = databases.getDocument as jest.Mock;
const mockList = databases.listDocuments as jest.Mock;

const user: TerminalContext = { userId: 'u1', email: 'op@scorpion.local', role: 'user' };
const admin: TerminalContext = { userId: 'u2', email: 'admin@scorpion.local', role: 'admin' };

beforeEach(() => {
    jest.clearAllMocks();
    __resetRegistryForTests();
    __resetDomainVerbsForTests();
    __resetAuditVerifyCooldownForTests();
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

describe('audit verify', () => {
    const intact = {
        db: { isValid: true, rowsChecked: 1420, latestSequence: 1419, legacyRows: 12, errors: [], samples: [{}, {}, {}, {}, {}] },
        anchor: { status: 'MATCH', verified: true, lokiConfigured: true, checked: 5, checks: [] },
        timestamp: '2026-08-05T00:00:00.000Z',
    };

    it('is admin-only', async () => {
        await expect(dispatch('audit verify', user)).rejects.toThrow(/requires role admin/);
        expect(mockVerify).not.toHaveBeenCalled();
    });

    it('reports an intact ledger with its metrics', async () => {
        mockVerify.mockResolvedValue(intact);

        const text = (await dispatch('audit verify', admin)).lines.join('\n');

        expect(text).toContain('chain:    VALID');
        expect(text).toContain('anchors:  MATCH');
        expect(text).toContain('1420 checked');
        expect(text).toContain('latest position 1419');
        expect(text).toContain('12 legacy');
        expect(text).toContain('5 of 5 position(s) cross-checked');
        expect(text).toMatch(/VERDICT: intact/);
    });

    it('lists broken links with their sequence numbers when the chain is invalid', async () => {
        mockVerify.mockResolvedValue({
            ...intact,
            db: {
                ...intact.db,
                isValid: false,
                errors: [
                    { kind: 'BROKEN_LINK', recordId: 'rec-77', sequence: 77, detail: 'stored tamper_hash does not match' },
                    { kind: 'GAP', recordId: 'rec-91', sequence: 91, detail: '1 row(s) are missing' },
                ],
            },
        });

        const text = (await dispatch('audit verify', admin)).lines.join('\n');

        expect(text).toContain('chain:    INVALID — 2 problem(s)');
        expect(text).toContain('BROKEN_LINK');
        expect(text).toContain('seq 77');
        expect(text).toContain('rec-77');
        expect(text).toContain('GAP');
        expect(text).toMatch(/VERDICT: TAMPER EVIDENCE/);
    });

    it('surfaces an anchor mismatch as tamper evidence even when the chain says VALID', async () => {
        // The whole reason the anchors exist: an attacker with the database credential
        // produces an internally valid chain. "chain: VALID" must not read as a pass.
        mockVerify.mockResolvedValue({
            ...intact,
            anchor: {
                status: 'ANCHOR_MISMATCH', verified: false, lokiConfigured: true, checked: 5,
                checks: [{ status: 'ANCHOR_MISMATCH', sequence: 300, recordId: 'r', dbHash: 'a', detail: 'hashes differently' }],
            },
        });

        const text = (await dispatch('audit verify', admin)).lines.join('\n');

        expect(text).toContain('chain:    VALID');
        expect(text).toContain('ANCHOR_MISMATCH');
        expect(text).toContain('seq 300');
        expect(text).toMatch(/VERDICT: TAMPER EVIDENCE/);
    });

    it('refuses to call an unverified-but-consistent chain a pass', async () => {
        mockVerify.mockResolvedValue({
            ...intact,
            anchor: {
                status: 'ANCHOR_UNAVAILABLE', verified: false, lokiConfigured: false, checked: 0,
                checks: [{ status: 'ANCHOR_UNAVAILABLE', sequence: 1, recordId: 'r', dbHash: 'a', detail: 'LOKI_URL is not set' }],
            },
        });

        const text = (await dispatch('audit verify', admin)).lines.join('\n');

        expect(text).toContain('chain:    VALID');
        expect(text).toMatch(/NOT cross-checked/);
        expect(text).toContain('Loki is not configured');
        expect(text).toMatch(/This is not a pass/);
        expect(text).not.toMatch(/VERDICT: intact/);
    });

    it('rejects a missing or wrong subcommand without running anything', async () => {
        await expect(dispatch('audit', admin)).rejects.toThrow(/usage: audit verify/);
        await expect(dispatch('audit repair', admin)).rejects.toThrow(/usage: audit verify/);
        expect(mockVerify).not.toHaveBeenCalled();
    });

    describe('access', () => {
        const security: TerminalContext = { userId: 'u3', email: 'sec@scorpion.local', role: 'security' };

        it('allows the security role, not just admin', async () => {
            mockVerify.mockResolvedValue(intact);

            await expect(dispatch('audit verify', security)).resolves.toBeDefined();
            expect(mockVerify).toHaveBeenCalled();
        });

        it('denies every other role with a 403 rather than a redacted report', async () => {
            const err = await dispatch('audit verify', user).catch((e: CommandError) => e);

            expect((err as CommandError).status).toBe(403);
            expect(mockVerify).not.toHaveBeenCalled();
        });
    });

    describe('cooldown', () => {
        it('refuses a second run inside the window with 429', async () => {
            mockVerify.mockResolvedValue(intact);
            await dispatch('audit verify', admin);

            const err = await dispatch('audit verify', admin).catch((e: CommandError) => e);

            expect((err as CommandError).status).toBe(429);
            expect((err as CommandError).message).toMatch(/rate limited/);
            expect(mockVerify).toHaveBeenCalledTimes(1);
        });

        it('names the verb on the 429, so the audit records what was refused', async () => {
            // CommandError.verb is what lets the route audit a resolved verb instead
            // of raw input. A rate-limit rejection with no verb would land in the
            // ledger as unattributed text.
            mockVerify.mockResolvedValue(intact);
            await dispatch('audit verify', admin);

            const err = await dispatch('audit verify', admin).catch((e: CommandError) => e);

            expect((err as CommandError).verb).toBe('audit');
        });

        it('reports the remaining seconds so the operator is not guessing', async () => {
            mockVerify.mockResolvedValue(intact);
            jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
            await dispatch('audit verify', admin);

            jest.spyOn(Date, 'now').mockReturnValue(1_000_000 + 60_000); // 1 min in
            const err = await dispatch('audit verify', admin).catch((e: CommandError) => e);

            expect((err as CommandError).message).toMatch(/try again in 120s/);
            jest.restoreAllMocks();
        });

        it('allows the run again once the window has passed', async () => {
            mockVerify.mockResolvedValue(intact);
            jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
            await dispatch('audit verify', admin);

            jest.spyOn(Date, 'now').mockReturnValue(1_000_000 + 3 * 60 * 1000 + 1);
            await expect(dispatch('audit verify', admin)).resolves.toBeDefined();

            expect(mockVerify).toHaveBeenCalledTimes(2);
            jest.restoreAllMocks();
        });

        it('is per user — one operator cooling down does not block another', async () => {
            mockVerify.mockResolvedValue(intact);
            const otherAdmin: TerminalContext = { userId: 'u9', email: 'a2@scorpion.local', role: 'admin' };

            await dispatch('audit verify', admin);
            await expect(dispatch('audit verify', otherAdmin)).resolves.toBeDefined();

            expect(mockVerify).toHaveBeenCalledTimes(2);
        });

        it('starts the cooldown before the run, not after it completes', async () => {
            // Stamping on completion would leave a second call free to start while
            // the first is still paging the ledger — the exact window being closed.
            let release: (v: unknown) => void = () => {};
            mockVerify.mockReturnValue(new Promise((r) => { release = r; }));

            const first = dispatch('audit verify', admin);
            const second = await dispatch('audit verify', admin).catch((e: CommandError) => e);

            expect((second as CommandError).status).toBe(429);

            release(intact);
            await first;
        });

        it('does not consume the cooldown when the subcommand was invalid', async () => {
            mockVerify.mockResolvedValue(intact);

            await expect(dispatch('audit repair', admin)).rejects.toThrow(/usage/);
            await expect(dispatch('audit verify', admin)).resolves.toBeDefined();
        });
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
