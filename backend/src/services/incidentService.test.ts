jest.mock('../lib/appwrite', () => ({
    databases: { createDocument: jest.fn(), updateDocument: jest.fn() },
    DB_ID: 'test-db',
    COLLECTIONS: { INCIDENTS: 'incidents' },
    ID: { unique: () => 'generated-id' },
}));
jest.mock('./slackService', () => ({
    sendSlackNotification: jest.fn(),
}));
jest.mock('./incidentActionService', () => ({
    freezeReleaseGateForIncident: jest.fn(),
    isCriticalSeverity: jest.fn((s: string) => (s || '').toLowerCase() === 'critical'),
}));

import { databases } from '../lib/appwrite';
import { createIncident, updateIncidentStatus } from './incidentService';
import { sendSlackNotification } from './slackService';
import { freezeReleaseGateForIncident } from './incidentActionService';

describe('createIncident', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.SLACK_WEBHOOK_URL;
    });

    it('persists the incident and skips Slack when no webhook is configured', async () => {
        (databases.createDocument as jest.Mock).mockResolvedValue({ $id: 'incident-1' });

        const doc = await createIncident({
            title: 'Reverse shell detected',
            severity: 'critical',
            source: 'falco',
            description: 'suspicious process',
        });

        expect(doc.$id).toBe('incident-1');
        expect(sendSlackNotification).not.toHaveBeenCalled();
    });

    it('sends a real Slack notification (not the old mock) when a webhook is configured', async () => {
        process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/abc';
        (databases.createDocument as jest.Mock).mockResolvedValue({ $id: 'incident-2' });

        await createIncident({
            title: 'Reverse shell detected',
            severity: 'critical',
            source: 'falco',
            description: 'suspicious process',
        });

        expect(sendSlackNotification).toHaveBeenCalledWith('https://hooks.slack.test/abc', expect.objectContaining({
            title: 'Reverse shell detected',
            incidentId: 'incident-2',
        }));
    });

    it('freezes the release gate for a critical incident', async () => {
        (databases.createDocument as jest.Mock).mockResolvedValue({ $id: 'incident-3' });

        await createIncident({
            title: 'GitOps drift detected',
            severity: 'critical',
            source: 'gitops',
            description: 'unexpected sync',
        });

        expect(freezeReleaseGateForIncident).toHaveBeenCalledWith(expect.stringContaining('incident-3'));
    });

    it('does not freeze the release gate for a non-critical incident', async () => {
        (databases.createDocument as jest.Mock).mockResolvedValue({ $id: 'incident-4' });

        await createIncident({
            title: 'Minor config drift',
            severity: 'low',
            source: 'gitops',
            description: 'cosmetic change',
        });

        expect(freezeReleaseGateForIncident).not.toHaveBeenCalled();
    });

    it('does not attach user_id when the incident has no resolvable owner', async () => {
        (databases.createDocument as jest.Mock).mockResolvedValue({ $id: 'incident-5' });

        await createIncident({
            title: 'Unowned GitOps app drift',
            severity: 'low',
            source: 'gitops',
            description: 'no linked repo',
        });

        const payload = (databases.createDocument as jest.Mock).mock.calls[0][3];
        expect(payload.user_id).toBeUndefined();
    });
});

describe('updateIncidentStatus', () => {
    it('sets resolvedAt only when transitioning to resolved', async () => {
        (databases.updateDocument as jest.Mock).mockResolvedValue({});

        await updateIncidentStatus('incident-1', 'investigating');
        expect((databases.updateDocument as jest.Mock).mock.calls[0][3]).not.toHaveProperty('resolvedAt');

        await updateIncidentStatus('incident-1', 'resolved');
        expect((databases.updateDocument as jest.Mock).mock.calls[1][3]).toHaveProperty('resolvedAt');
    });
});
