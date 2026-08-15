jest.mock('../lib/appwrite', () => ({
    databases: {
        getCollection: jest.fn(),
        listDocuments: jest.fn(),
        updateDocument: jest.fn(),
        createDocument: jest.fn(),
    },
    DB_ID: 'test-db',
    ID: { unique: () => 'generated-id' },
    Query: {
        equal: (field: string, value: unknown) => ({ equal: [field, value] }),
        limit: (n: number) => ({ limit: n }),
    },
}));

// requireActual so errorContext stays real — mocking the whole module leaves it
// undefined and the spread under test throws instead of asserting.
jest.mock('./logger', () => ({
    ...jest.requireActual('./logger'),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { databases } from '../lib/appwrite';
import { logger } from './logger';
import { freezeReleaseGateForIncident, isCriticalSeverity } from './incidentActionService';

describe('isCriticalSeverity', () => {
    it('matches "critical" case-insensitively', () => {
        expect(isCriticalSeverity('critical')).toBe(true);
        expect(isCriticalSeverity('CRITICAL')).toBe(true);
        expect(isCriticalSeverity('Critical')).toBe(true);
    });

    it('does not match other severities', () => {
        expect(isCriticalSeverity('high')).toBe(false);
        expect(isCriticalSeverity('Error')).toBe(false);
        expect(isCriticalSeverity('')).toBe(false);
    });
});

describe('freezeReleaseGateForIncident', () => {
    beforeEach(() => jest.clearAllMocks());

    it('updates the existing pipeline_state document to BLOCKED', async () => {
        (databases.getCollection as jest.Mock).mockResolvedValue({});
        (databases.listDocuments as jest.Mock).mockResolvedValue({ total: 1, documents: [{ $id: 'state-1' }] });

        await freezeReleaseGateForIncident('test reason');

        expect(databases.updateDocument).toHaveBeenCalledWith('test-db', 'pipeline_state', 'state-1', { status: 'BLOCKED' });
        expect(databases.createDocument).not.toHaveBeenCalled();
    });

    it('creates a pipeline_state document when none exists yet', async () => {
        (databases.getCollection as jest.Mock).mockResolvedValue({});
        (databases.listDocuments as jest.Mock).mockResolvedValue({ total: 0, documents: [] });

        await freezeReleaseGateForIncident('test reason');

        expect(databases.createDocument).toHaveBeenCalledWith('test-db', 'pipeline_state', 'generated-id', {
            nodeId: 'release',
            status: 'BLOCKED',
        });
    });

    it('never throws even if the database calls fail (containment is best-effort)', async () => {
        (databases.getCollection as jest.Mock).mockRejectedValue(new Error('boom'));
        (databases.listDocuments as jest.Mock).mockRejectedValue(new Error('boom'));

        await expect(freezeReleaseGateForIncident('test reason')).resolves.toBeUndefined();
    });

    // The failure is silent by design (containment is best-effort), so the log is
    // the ONLY signal that releases are still flowing during a critical incident.
    // A CRITICAL alert that cannot name the incident is not actionable, so the
    // correlator is part of the contract, not decoration.
    it('names the incident in the failure log', async () => {
        const reason = 'falco incident "Terminal shell in container" (inc-42)';
        (databases.getCollection as jest.Mock).mockRejectedValue(new Error('boom'));
        (databases.listDocuments as jest.Mock).mockRejectedValue(new Error('boom'));

        await freezeReleaseGateForIncident(reason);

        expect(logger.error).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ event: 'INCIDENT_GATE_FREEZE_FAILED', reason }),
        );
    });
});
