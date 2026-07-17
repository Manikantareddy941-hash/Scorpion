jest.mock('../lib/appwrite', () => ({
    databases: { listDocuments: jest.fn(), getDocument: jest.fn() },
    DB_ID: 'db',
    COLLECTIONS: {
        REPORTS_SCHEDULE: 'reports_schedule',
        VULNERABILITIES: 'vulnerabilities',
        INCIDENTS: 'incidents'
    },
    Query: { equal: jest.fn(), limit: jest.fn(), greaterThanEqual: jest.fn() }
}));
jest.mock('../queues/reportQueue', () => ({
    reportQueue: {
        getJobSchedulers: jest.fn(),
        upsertJobScheduler: jest.fn(),
        removeJobScheduler: jest.fn()
    }
}));
jest.mock('./aiService', () => ({
    generateSecuritySummary: jest.fn().mockResolvedValue('## summary')
}));
jest.mock('./emailService', () => ({
    sendAiReportEmail: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('./logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));
jest.mock('marked', () => ({
    marked: { parse: jest.fn(async (md: string) => `<html>${md}</html>`) }
}));

import { runScheduledReport, reconcileReportSchedules } from './scheduleService';
import { databases } from '../lib/appwrite';
import { reportQueue } from '../queues/reportQueue';
import { sendAiReportEmail } from './emailService';

const getDocument = databases.getDocument as jest.Mock;
const listDocuments = databases.listDocuments as jest.Mock;
const getJobSchedulers = reportQueue.getJobSchedulers as unknown as jest.Mock;
const upsertJobScheduler = reportQueue.upsertJobScheduler as unknown as jest.Mock;
const removeJobScheduler = reportQueue.removeJobScheduler as unknown as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    getJobSchedulers.mockResolvedValue([]);
});

describe('runScheduledReport', () => {
    it('generates and emails the report to every recipient', async () => {
        getDocument.mockResolvedValue({
            $id: 's1',
            is_active: true,
            emails: ['a@x.com', 'b@x.com'],
            range: '24h'
        });
        listDocuments.mockResolvedValue({ documents: [] });

        await runScheduledReport('s1');

        expect(sendAiReportEmail).toHaveBeenCalledTimes(2);
        expect(sendAiReportEmail).toHaveBeenCalledWith('a@x.com', expect.stringContaining('summary'), '24h');
    });

    it('skips deactivated schedules without emailing', async () => {
        getDocument.mockResolvedValue({ $id: 's1', is_active: false });

        await runScheduledReport('s1');

        expect(sendAiReportEmail).not.toHaveBeenCalled();
    });
});

describe('reconcileReportSchedules', () => {
    it('upserts active schedules and removes stale ones', async () => {
        listDocuments.mockResolvedValue({
            documents: [{ $id: 's1', cron_schedule: '0 8 * * 1' }]
        });
        getJobSchedulers.mockResolvedValue([{ key: 'report-s-old' }]);

        await reconcileReportSchedules();

        expect(upsertJobScheduler).toHaveBeenCalledWith(
            'report-s1',
            { pattern: '0 8 * * 1' },
            { name: 'ai-report', data: { scheduleId: 's1' } }
        );
        expect(removeJobScheduler).toHaveBeenCalledWith('report-s-old');
    });
});
