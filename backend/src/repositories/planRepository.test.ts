jest.mock('../lib/appwrite', () => ({
    databases: {
        listDocuments: jest.fn(),
    },
    DB_ID: 'test-db',
    COLLECTIONS: { REPOSITORIES: 'repositories', FINDINGS: 'findings' },
    ID: { unique: jest.fn(() => 'generated-id') },
    Query: {
        equal: (field: string, value: unknown) => ({ equal: [field, value] }),
        limit: (n: number) => ({ limit: n }),
        offset: (n: number) => ({ offset: n }),
    },
}));

import { planRepository } from './planRepository';
import { databases } from '../lib/appwrite';

describe('listVulnerabilitiesForUser pagination', () => {
    beforeEach(() => jest.clearAllMocks());

    const mockListDocuments = databases.listDocuments as jest.Mock;

    it('pages past the first 100 findings instead of silently truncating', async () => {
        const page1 = Array.from({ length: 100 }, (_, i) => ({ $id: `finding-${i}` }));
        const page2 = Array.from({ length: 40 }, (_, i) => ({ $id: `finding-${100 + i}` }));

        mockListDocuments.mockImplementation((_db: string, collection: string) => {
            if (collection === 'repositories') return Promise.resolve({ total: 1, documents: [{ $id: 'repo-1' }] });
            if (collection === 'findings') {
                const call = mockListDocuments.mock.calls.filter((c: unknown[]) => c[1] === 'findings').length;
                return Promise.resolve({ documents: call === 1 ? page1 : page2 });
            }
            return Promise.resolve({ total: 0, documents: [] });
        });

        const result = await planRepository.listVulnerabilitiesForUser('user-1');

        expect(result).toHaveLength(140);
    });

    it('returns [] when the user has no repositories, without querying findings', async () => {
        mockListDocuments.mockResolvedValue({ total: 0, documents: [] });

        const result = await planRepository.listVulnerabilitiesForUser('user-1');

        expect(result).toEqual([]);
    });
});
