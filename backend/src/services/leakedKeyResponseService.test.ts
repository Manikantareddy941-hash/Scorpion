import crypto from 'crypto';

jest.mock('../lib/appwrite', () => ({
    databases: {
        listDocuments: jest.fn(),
        deleteDocument: jest.fn(),
    },
    DB_ID: 'test-db',
    COLLECTIONS: { API_KEYS: 'api_keys' },
    Query: { equal: (field: string, value: unknown) => ({ equal: [field, value] }) },
}));
jest.mock('./incidentService', () => ({
    createIncident: jest.fn(),
}));

import { databases } from '../lib/appwrite';
import { createIncident } from './incidentService';
import { respondToLeakedKeys } from './leakedKeyResponseService';

const realKey = `sp_${'a'.repeat(48)}`;
const realKeyHash = crypto.createHash('sha256').update(realKey).digest('hex');

describe('respondToLeakedKeys', () => {
    beforeEach(() => jest.clearAllMocks());

    it('does nothing when there is no resolvable owner', async () => {
        await respondToLeakedKeys([{ Match: realKey }], undefined, 'repo-1');

        expect(databases.listDocuments).not.toHaveBeenCalled();
    });

    it('does nothing when there are no gitleaks matches', async () => {
        await respondToLeakedKeys([], 'user-1', 'repo-1');

        expect(databases.listDocuments).not.toHaveBeenCalled();
    });

    it('ignores matches that are not in the sp_<hex> key format', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({
            total: 1,
            documents: [{ $id: 'key-1', name: 'CI key', key_hash: realKeyHash }],
        });

        await respondToLeakedKeys([{ Match: 'just some random string', RuleID: 'generic-api-key', File: 'config.ts' }], 'user-1', 'repo-1');

        expect(databases.deleteDocument).not.toHaveBeenCalled();
        expect(createIncident).not.toHaveBeenCalled();
    });

    it('revokes the exact key and raises a critical incident when a match is found', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({
            total: 1,
            documents: [{ $id: 'key-1', name: 'CI key', key_hash: realKeyHash }],
        });

        await respondToLeakedKeys(
            [{ Match: `token: ${realKey}`, RuleID: 'scorpion-api-key', File: 'src/config.ts' }],
            'user-1',
            'repo-1'
        );

        expect(databases.deleteDocument).toHaveBeenCalledWith('test-db', 'api_keys', 'key-1');
        expect(createIncident).toHaveBeenCalledWith(expect.objectContaining({
            severity: 'critical',
            source: 'ci_pipeline',
            userId: 'user-1',
        }));
    });

    it('does not revoke a key whose hash does not match any leaked candidate', async () => {
        (databases.listDocuments as jest.Mock).mockResolvedValue({
            total: 1,
            documents: [{ $id: 'key-1', name: 'CI key', key_hash: 'some-other-hash' }],
        });

        await respondToLeakedKeys([{ Match: realKey, RuleID: 'scorpion-api-key', File: 'config.ts' }], 'user-1', 'repo-1');

        expect(databases.deleteDocument).not.toHaveBeenCalled();
    });

    it('never throws even if the database calls fail (best-effort)', async () => {
        (databases.listDocuments as jest.Mock).mockRejectedValue(new Error('boom'));

        await expect(respondToLeakedKeys([{ Match: realKey }], 'user-1', 'repo-1')).resolves.toBeUndefined();
    });
});
