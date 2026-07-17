jest.mock('./lib/appwrite', () => ({
    databases: { listDocuments: jest.fn() },
    DB_ID: 'db',
    COLLECTIONS: { REPOSITORIES: 'repositories' },
    Query: { equal: jest.fn(), limit: jest.fn() }
}));
jest.mock('./queues/scanQueue', () => ({
    scanQueue: {
        getJobSchedulers: jest.fn(),
        upsertJobScheduler: jest.fn(),
        removeJobScheduler: jest.fn()
    }
}));
jest.mock('./services/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

import { reconcileScanSchedules } from './scheduler';
import { databases } from './lib/appwrite';
import { scanQueue } from './queues/scanQueue';

const listDocuments = databases.listDocuments as jest.Mock;
const getJobSchedulers = scanQueue.getJobSchedulers as unknown as jest.Mock;
const upsertJobScheduler = scanQueue.upsertJobScheduler as unknown as jest.Mock;
const removeJobScheduler = scanQueue.removeJobScheduler as unknown as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    getJobSchedulers.mockResolvedValue([]);
});

test('upserts a redis-backed job scheduler per cron-enabled repo', async () => {
    listDocuments.mockResolvedValue({
        documents: [{ $id: 'repo-1', cron_schedule: '0 2 * * *' }]
    });

    await reconcileScanSchedules();

    expect(upsertJobScheduler).toHaveBeenCalledWith(
        'repo-scan-repo-1',
        { pattern: '0 2 * * *' },
        { name: 'scan', data: { repoId: 'repo-1', options: {} } }
    );
});

test('removes schedulers whose repo disabled cron', async () => {
    listDocuments.mockResolvedValue({ documents: [] });
    getJobSchedulers.mockResolvedValue([
        { key: 'repo-scan-gone' },
        { key: 'unrelated-scheduler' }
    ]);

    await reconcileScanSchedules();

    expect(removeJobScheduler).toHaveBeenCalledWith('repo-scan-gone');
    expect(removeJobScheduler).not.toHaveBeenCalledWith('unrelated-scheduler');
});

test('skips invalid cron expressions without touching the queue', async () => {
    listDocuments.mockResolvedValue({
        documents: [{ $id: 'repo-bad', cron_schedule: 'not-a-cron' }]
    });

    await reconcileScanSchedules();

    expect(upsertJobScheduler).not.toHaveBeenCalled();
});

test('defaults to daily midnight when the repo has no schedule', async () => {
    listDocuments.mockResolvedValue({ documents: [{ $id: 'repo-2' }] });

    await reconcileScanSchedules();

    expect(upsertJobScheduler).toHaveBeenCalledWith(
        'repo-scan-repo-2',
        { pattern: '0 0 * * *' },
        expect.anything()
    );
});
