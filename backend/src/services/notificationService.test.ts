/**
 * notificationService: webhook fan-out (Slack + Discord) with repo-name
 * resolution, config-gated skipping, fail-safe dispatch, and the policy
 * failure / overdue-task helpers. fetch and Appwrite are mocked.
 */

jest.mock('../lib/appwrite', () => ({
  databases: {
    getDocument: jest.fn(),
    listDocuments: jest.fn(),
  },
  DB_ID: 'test-db',
  COLLECTIONS: { REPOSITORIES: 'repositories', TASKS: 'tasks' },
  Query: {
    equal: (f: string, v: unknown) => ({ equal: [f, v] }),
    limit: (n: number) => ({ limit: n }),
  },
}));
jest.mock('./logger', () => ({
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('./logger'),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { sendSecurityAlert, notifyPolicyFailure, checkOverdueTasks, notifyScanCompletion } from './notificationService';
import { databases } from '../lib/appwrite';
import { logger } from './logger';

const db = databases as jest.Mocked<typeof databases>;
const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const flush = () => new Promise((r) => setImmediate(r));

const baseEvent = {
  type: 'threat' as const,
  title: 'Crypto miner spawned',
  severity: 'CRITICAL' as const,
  details: 'xmrig detected in pod',
  repo_id: 'repo-1',
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SLACK_WEBHOOK_URL;
  delete process.env.DISCORD_WEBHOOK_URL;
  fetchMock.mockResolvedValue({ status: 200 });
  db.getDocument.mockResolvedValue({ $id: 'repo-1', name: 'acme-api' } as never);
});

describe('sendSecurityAlert', () => {
  it('skips both channels when no webhook is configured', async () => {
    await sendSecurityAlert(baseEvent);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('dispatches Slack blocks and Discord embeds with the resolved repo name', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/x';
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.test/x';

    await sendSecurityAlert(baseEvent);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const slackBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(slackBody.blocks[0].text.text).toContain('INTRUSION DETECTED');
    expect(slackBody.blocks[1].text.text).toContain('acme-api');

    const discordBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(discordBody.embeds[0].color).toBe(16711765); // critical → crimson
    expect(discordBody.embeds[0].description).toContain('acme-api');
  });

  it('uses the cyan color for lower severities and gate_blocked wording', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.test/x';

    await sendSecurityAlert({ ...baseEvent, type: 'gate_blocked', severity: 'MEDIUM' });
    await flush();

    const discordBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(discordBody.embeds[0].color).toBe(61951);
    expect(discordBody.embeds[0].title).toContain('CD GATE BLOCKED');
  });

  it('falls back to the repo id when name resolution fails, and never throws', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/x';
    db.getDocument.mockRejectedValue(new Error('missing'));

    await expect(sendSecurityAlert(baseEvent)).resolves.toBeUndefined();
    await flush();

    const slackBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(slackBody.blocks[1].text.text).toContain('repo-1');
  });

  it('skips the repo lookup for system events', async () => {
    await sendSecurityAlert({ ...baseEvent, repo_id: 'system' });
    expect(db.getDocument).not.toHaveBeenCalled();
  });

  it('survives webhook delivery failures', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/x';
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(sendSecurityAlert(baseEvent)).resolves.toBeUndefined();
    await flush();
    // Asserted on the metadata object, not on a second positional argument. The
    // previous form checked that 'ECONNREFUSED' was *passed to* logger.error — which
    // it was, and which winston then dropped on the floor for want of format.splat().
    // The test passed for the entire period the cause was missing from the logs.
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('dispatch aborted or failed'),
      expect.objectContaining({
        event_name: 'NOTIFICATION_DISPATCH_FAILED',
        channel: 'slack',
        error: 'ECONNREFUSED',
      }),
    );
  });
});

describe('notifyPolicyFailure', () => {
  it('wraps the failure into a HIGH gate_blocked alert', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/x';

    await notifyPolicyFailure('repo-1', 'scan-9', 'FAIL', 'too many criticals');
    await flush();

    const slackBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(slackBody.blocks[1].text.text).toContain('Policy Evaluation Failure');
    expect(slackBody.blocks[1].text.text).toContain('too many criticals');
  });
});

describe('checkOverdueTasks', () => {
  it('counts tasks past their due date', async () => {
    db.listDocuments.mockResolvedValue({
      documents: [
        { $id: 't1', due_date: '2020-01-01' },
        { $id: 't2', due_date: new Date(Date.now() + 86_400_000).toISOString() },
        { $id: 't3' },
      ],
    } as never);

    await checkOverdueTasks();

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Found 1 overdue tasks'));
  });

  it('logs and continues on lookup failure', async () => {
    db.listDocuments.mockRejectedValue(new Error('down'));
    await expect(checkOverdueTasks()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('notifyScanCompletion', () => {
  it('logs the completion event', async () => {
    await notifyScanCompletion('scan-1', 'repo-1', 'completed');
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('scan-1'));
  });
});
