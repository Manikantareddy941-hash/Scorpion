jest.mock('../lib/appwrite', () => ({
    databases: { listDocuments: jest.fn() },
    DB_ID: 'test-db',
    Query: {
        equal: (field: string, value: unknown) => ({ equal: [field, value] }),
        limit: (n: number) => ({ limit: n }),
    },
    ID: { unique: () => 'generated-id' },
}));
jest.mock('../services/policyService', () => ({
    getDynamicPolicy: jest.fn(),
}));
jest.mock('../services/opaService', () => ({
    evaluatePolicy: jest.fn(),
}));

import { databases } from '../lib/appwrite';
import { getDynamicPolicy } from '../services/policyService';
import { evaluatePolicy } from '../services/opaService';
import { checkReleaseGate } from './gateRoutes';

describe('checkReleaseGate', () => {
    beforeEach(() => jest.clearAllMocks());

    it('allows the release when thresholds pass and no custom Rego policy is configured', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({ documents: [] });
        (getDynamicPolicy as jest.Mock).mockResolvedValue({ minSecurityScore: 80, blockOnCritical: true });

        const result = await checkReleaseGate('repo-1');

        expect(result.allowed).toBe(true);
        expect(evaluatePolicy).not.toHaveBeenCalled();
    });

    it('blocks on the existing threshold check exactly as before, regardless of Rego', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({
            documents: [{ severity: 'critical' }],
        });
        (getDynamicPolicy as jest.Mock).mockResolvedValue({ minSecurityScore: 80, blockOnCritical: true });

        const result = await checkReleaseGate('repo-1');

        expect(result.allowed).toBe(false);
        expect(evaluatePolicy).not.toHaveBeenCalled();
    });

    it('additionally blocks when a configured custom Rego policy denies, even if thresholds pass', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({ documents: [] });
        (getDynamicPolicy as jest.Mock).mockResolvedValue({
            minSecurityScore: 80,
            blockOnCritical: true,
            regoCode: 'package scorpion.gate',
        });
        (evaluatePolicy as jest.Mock).mockResolvedValue({ allow: false, denyReasons: ['custom rule violated'] });

        const result = await checkReleaseGate('repo-1');

        expect(result.allowed).toBe(false);
        expect((result as any).regoDenyReasons).toEqual(['custom rule violated']);
    });

    it('stays allowed when the custom Rego policy also allows', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({ documents: [] });
        (getDynamicPolicy as jest.Mock).mockResolvedValue({
            minSecurityScore: 80,
            blockOnCritical: true,
            regoCode: 'package scorpion.gate',
        });
        (evaluatePolicy as jest.Mock).mockResolvedValue({ allow: true, denyReasons: [] });

        const result = await checkReleaseGate('repo-1');

        expect(result.allowed).toBe(true);
        expect((result as any).regoDenyReasons).toBeUndefined();
    });

    it('does not let an OPA evaluation failure (e.g. opa not installed) block an otherwise-passing gate', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({ documents: [] });
        (getDynamicPolicy as jest.Mock).mockResolvedValue({
            minSecurityScore: 80,
            blockOnCritical: true,
            regoCode: 'package scorpion.gate',
        });
        (evaluatePolicy as jest.Mock).mockRejectedValue(new Error('OPA is not installed on this host.'));

        const result = await checkReleaseGate('repo-1');

        expect(result.allowed).toBe(true);
    });
});
