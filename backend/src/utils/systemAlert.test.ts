jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../services/logger', () => ({
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('../services/logger'),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import axios from 'axios';
import { logger } from '../services/logger';
import { sendSystemAlert, systemAlertConfigured } from './systemAlert';

const post = axios.post as jest.Mock;
const originalEnv = { ...process.env };

const clearSinks = () => {
    delete process.env.SYSTEM_ALERT_WEBHOOK_URL;
    delete process.env.SYSTEM_ALERT_PAGERDUTY_KEY;
    delete process.env.SYSTEM_ALERT_SLACK_WEBHOOK;
};

beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    clearSinks();
    post.mockResolvedValue({ status: 200 });
});
afterAll(() => { process.env = originalEnv; });

const alert = { level: 'CRITICAL' as const, title: 'Audit Ledger Tampering Suspected', message: 'anchor mismatch at position 42' };

describe('unconfigured', () => {
    it('reports ZERO deliveries rather than silent success', async () => {
        // The whole point. A void return would make "nobody is listening"
        // indistinguishable from "an operator was paged".
        expect(await sendSystemAlert(alert)).toBe(0);
        expect(post).not.toHaveBeenCalled();
    });

    it('says out loud that the alert reached only the log', async () => {
        await sendSystemAlert(alert);
        const messages = (logger.error as jest.Mock).mock.calls.map(c => String(c[0]));
        expect(messages.some(m => /no system alert sink is configured/.test(m))).toBe(true);
    });

    it('still records the alert locally, so it is not lost entirely', async () => {
        await sendSystemAlert(alert);
        expect((logger.error as jest.Mock).mock.calls[0][0]).toMatch(/Audit Ledger Tampering Suspected/);
    });
});

describe('delivery', () => {
    it('sends to every configured sink and counts them', async () => {
        process.env.SYSTEM_ALERT_SLACK_WEBHOOK = 'https://slack.test/hook';
        process.env.SYSTEM_ALERT_PAGERDUTY_KEY = 'pd-key';
        process.env.SYSTEM_ALERT_WEBHOOK_URL = 'https://siem.test/in';

        expect(await sendSystemAlert(alert)).toBe(3);
        expect(post).toHaveBeenCalledTimes(3);
    });

    it('keeps delivering when one sink fails', async () => {
        // The alert being suppressed by a broken webhook is the one saying the
        // ledger was rewritten. Sinks are independent on purpose.
        //
        // Slack must reject BOTH attempts to count as down — a single rejection is
        // now recovered by the retry, which is the point of having one.
        process.env.SYSTEM_ALERT_SLACK_WEBHOOK = 'https://slack.test/hook';
        process.env.SYSTEM_ALERT_PAGERDUTY_KEY = 'pd-key';
        post
            .mockRejectedValueOnce(new Error('slack 500'))
            .mockRejectedValueOnce(new Error('slack 500'))
            .mockResolvedValueOnce({ status: 202 });

        expect(await sendSystemAlert(alert)).toBe(1);
    });

    it('retries a sink once before giving up on it', async () => {
        // Without this, a single transient failure on the DAILY full walk buries a
        // tamper finding for 24 hours — the tail's cadence does not cover it.
        process.env.SYSTEM_ALERT_SLACK_WEBHOOK = 'https://slack.test/hook';
        post.mockRejectedValue(new Error('ECONNRESET'));

        expect(await sendSystemAlert(alert)).toBe(0);
        expect(post).toHaveBeenCalledTimes(2);
    });

    it('counts a sink that succeeded on the retry', async () => {
        process.env.SYSTEM_ALERT_SLACK_WEBHOOK = 'https://slack.test/hook';
        post.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce({ status: 200 });

        expect(await sendSystemAlert(alert)).toBe(1);
    });

    it('bounds every sink with a timeout', async () => {
        // A hung webhook would otherwise stall the worker holding the queue lock.
        process.env.SYSTEM_ALERT_WEBHOOK_URL = 'https://siem.test/in';

        await sendSystemAlert(alert);

        expect(post.mock.calls[0][2]).toEqual(expect.objectContaining({ timeout: expect.any(Number) }));
    });

    it('never writes a webhook URL into the log', async () => {
        // A Slack webhook carries its secret in the path, and this deployment ships
        // logs to the same Loki that stores the audit anchors. Logging the axios
        // error object rather than its message would put a live credential there.
        process.env.SYSTEM_ALERT_SLACK_WEBHOOK = 'https://hooks.slack.com/services/T0/B0/xoxb-secret-path';
        post.mockRejectedValue(Object.assign(new Error('Request failed'), {
            config: { url: 'https://hooks.slack.com/services/T0/B0/xoxb-secret-path' },
        }));

        await sendSystemAlert(alert);

        expect(JSON.stringify((logger.error as jest.Mock).mock.calls)).not.toContain('xoxb-secret-path');
    });

    it('returns 0 and says so when every sink fails', async () => {
        process.env.SYSTEM_ALERT_PAGERDUTY_KEY = 'pd-key';
        post.mockRejectedValue(new Error('network down'));

        expect(await sendSystemAlert(alert)).toBe(0);
        const messages = (logger.error as jest.Mock).mock.calls.map(c => String(c[0]));
        expect(messages.some(m => /every configured sink failed/.test(m))).toBe(true);
    });

    it('NEVER throws — a failed alert must not abort the caller', async () => {
        process.env.SYSTEM_ALERT_WEBHOOK_URL = 'https://siem.test/in';
        post.mockRejectedValue(new Error('boom'));
        await expect(sendSystemAlert(alert)).resolves.toBe(0);
    });
});

describe('payload shape', () => {
    it('maps CRITICAL and WARN to PagerDuty severities', async () => {
        process.env.SYSTEM_ALERT_PAGERDUTY_KEY = 'pd-key';

        await sendSystemAlert(alert);
        expect(post.mock.calls[0][1].payload.severity).toBe('critical');

        jest.clearAllMocks();
        await sendSystemAlert({ ...alert, level: 'WARN' });
        expect(post.mock.calls[0][1].payload.severity).toBe('warning');
    });

    it('sets a dedup key so a persistent outage does not page every 15 minutes', async () => {
        process.env.SYSTEM_ALERT_PAGERDUTY_KEY = 'pd-key';
        await sendSystemAlert(alert);
        expect(post.mock.calls[0][1].dedup_key).toBe('scorpion-system-Audit Ledger Tampering Suspected');
    });

    it('carries no userId, repo or file — a system incident owns none of them', async () => {
        process.env.SYSTEM_ALERT_WEBHOOK_URL = 'https://siem.test/in';
        await sendSystemAlert({ ...alert, details: { sequence: 42 } });

        const body = post.mock.calls[0][1];
        expect(body).toMatchObject({ level: 'CRITICAL', source: 'scorpion', details: { sequence: 42 } });
        expect(body).not.toHaveProperty('repo_name');
        expect(body).not.toHaveProperty('userId');
    });
});

describe('systemAlertConfigured', () => {
    it('is false with no sinks and true with any one', () => {
        expect(systemAlertConfigured()).toBe(false);
        process.env.SYSTEM_ALERT_PAGERDUTY_KEY = 'k';
        expect(systemAlertConfigured()).toBe(true);
    });
});
