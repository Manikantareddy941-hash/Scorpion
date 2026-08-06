jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../lib/appwrite', () => ({ __esModule: true, default: {}, DB_ID: 'db' }));
jest.mock('node-appwrite', () => ({
    Databases: jest.fn().mockImplementation(() => ({ listDocuments: jest.fn() })),
    Query: { equal: jest.fn(), limit: jest.fn() },
}));
jest.mock('../services/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import axios from 'axios';
import { sendSystemAlert } from './alertDispatcher';
import { logger } from '../services/logger';

const mockPost = axios.post as jest.Mock;
const mockError = logger.error as jest.Mock;

const SECRET_SLACK = 'https://hooks.slack.com/services/T000/B000/xoxb-secret-path';

const alert = { channel: 'security' as const, title: 'Ledger tampered', detail: 'seq 900 broken' };

const originalEnv = process.env;

beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.SECURITY_ALERT_SLACK_WEBHOOK;
    delete process.env.SECURITY_ALERT_PAGERDUTY_KEY;
    delete process.env.OPS_ALERT_SLACK_WEBHOOK;
    delete process.env.OPS_ALERT_PAGERDUTY_KEY;
});
afterAll(() => { process.env = originalEnv; });

describe('routing', () => {
    it('reports configured: 0 when the channel has no destination', async () => {
        // The case that matters most: an alert with nowhere to go is
        // indistinguishable from no alert unless the caller is told.
        const result = await sendSystemAlert(alert);

        expect(result).toEqual({ delivered: 0, configured: 0 });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it('reads security destinations, not ops ones, for a security alert', async () => {
        process.env.OPS_ALERT_SLACK_WEBHOOK = 'https://hooks.slack.com/ops';
        mockPost.mockResolvedValue({});

        const result = await sendSystemAlert(alert);

        expect(result.configured).toBe(0);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it('sends ops alerts to the ops destination', async () => {
        process.env.OPS_ALERT_SLACK_WEBHOOK = 'https://hooks.slack.com/ops';
        mockPost.mockResolvedValue({});

        const result = await sendSystemAlert({ ...alert, channel: 'ops' });

        expect(result).toEqual({ delivered: 1, configured: 1 });
        expect(mockPost.mock.calls[0][0]).toBe('https://hooks.slack.com/ops');
    });

    it('marks a security page critical and an ops page warning', async () => {
        process.env.SECURITY_ALERT_PAGERDUTY_KEY = 'sec-key';
        process.env.OPS_ALERT_PAGERDUTY_KEY = 'ops-key';
        mockPost.mockResolvedValue({});

        await sendSystemAlert(alert);
        await sendSystemAlert({ ...alert, channel: 'ops' });

        expect(mockPost.mock.calls[0][1].payload.severity).toBe('critical');
        expect(mockPost.mock.calls[1][1].payload.severity).toBe('warning');
    });
});

describe('isolation', () => {
    it('still delivers to PagerDuty when Slack is dead', async () => {
        process.env.SECURITY_ALERT_SLACK_WEBHOOK = SECRET_SLACK;
        process.env.SECURITY_ALERT_PAGERDUTY_KEY = 'sec-key';
        mockPost
            .mockRejectedValueOnce(new Error('slack down'))   // attempt 1
            .mockRejectedValueOnce(new Error('slack down'))   // retry
            .mockResolvedValue({});                            // pagerduty

        const result = await sendSystemAlert(alert);

        expect(result).toEqual({ delivered: 1, configured: 2 });
    });
});

describe('retry', () => {
    it('retries once before giving up', async () => {
        // Without this, a single transient failure on the DAILY full walk buries a
        // tamper finding for 24 hours.
        process.env.SECURITY_ALERT_SLACK_WEBHOOK = SECRET_SLACK;
        mockPost.mockRejectedValue(new Error('ECONNRESET'));

        const result = await sendSystemAlert(alert);

        expect(mockPost).toHaveBeenCalledTimes(2);
        expect(result).toEqual({ delivered: 0, configured: 1 });
    });

    it('counts a delivery that succeeded on the retry', async () => {
        process.env.SECURITY_ALERT_SLACK_WEBHOOK = SECRET_SLACK;
        mockPost
            .mockRejectedValueOnce(new Error('ECONNRESET'))
            .mockResolvedValue({});

        const result = await sendSystemAlert(alert);

        expect(result).toEqual({ delivered: 1, configured: 1 });
    });
});

describe('secret hygiene', () => {
    it('never writes the webhook URL into the log', async () => {
        // A Slack webhook carries its secret in the path. Logging the axios error
        // object (rather than its message) would write a live credential to the
        // log stream.
        process.env.SECURITY_ALERT_SLACK_WEBHOOK = SECRET_SLACK;
        mockPost.mockRejectedValue(Object.assign(new Error('Request failed'), {
            config: { url: SECRET_SLACK },
        }));

        await sendSystemAlert(alert);

        const logged = JSON.stringify(mockError.mock.calls);
        expect(logged).not.toContain('xoxb-secret-path');
    });
});
