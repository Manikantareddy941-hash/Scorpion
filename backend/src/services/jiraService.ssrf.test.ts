jest.mock('axios');

// requireActual so errorContext stays real — a wholesale module mock leaves it
// undefined and the spread in the catch throws instead of asserting.
jest.mock('./logger', () => ({
    ...jest.requireActual('./logger'),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../repositories/ticketsRepository', () => ({
    ticketsRepository: { getTicket: jest.fn(), updateTicket: jest.fn(), listTickets: jest.fn() },
}));

import axios from 'axios';
import { setJiraConfig, testConnection } from './jiraService';
import type { JiraConfig } from '../../../shared/types';

const mockedAxios = axios as unknown as jest.Mock;

const configFor = (baseUrl: string): JiraConfig => ({
    baseUrl,
    email: 'user@example.com',
    apiToken: 'super-secret-token',
    projectKey: 'SEC',
} as JiraConfig);

describe('jiraService SSRF guard', () => {
    beforeEach(() => jest.clearAllMocks());

    // The assertion that matters is that axios was NEVER called. A test that only
    // checked `ok: false` would pass even if the request went out and merely
    // failed — which is the exact outcome the guard exists to prevent.
    it.each([
        ['loopback by name', 'https://localhost/jira'],
        ['plaintext http, which would also leak the Basic auth token', 'http://jira.example.com'],
    ])('refuses %s without issuing a request', async (_label, baseUrl) => {
        setJiraConfig(configFor(baseUrl));

        const result = await testConnection();

        expect(result.ok).toBe(false);
        expect(mockedAxios).not.toHaveBeenCalled();
    });

    it('allows an ordinary https Jira Cloud host through to the request', async () => {
        mockedAxios.mockResolvedValue({ data: { name: 'Security' } });
        setJiraConfig(configFor('https://example.atlassian.net'));

        const result = await testConnection();

        expect(result).toEqual({ ok: true, projectName: 'Security' });
        expect(mockedAxios).toHaveBeenCalledTimes(1);
    });

    // The config is mutable at runtime, so a guard that ran only in setJiraConfig
    // would let a later call reuse a value that has since been replaced.
    it('re-checks on every call, not once at configuration time', async () => {
        mockedAxios.mockResolvedValue({ data: { name: 'Security' } });
        setJiraConfig(configFor('https://example.atlassian.net'));
        await testConnection();
        expect(mockedAxios).toHaveBeenCalledTimes(1);

        setJiraConfig(configFor('https://localhost/jira'));
        const result = await testConnection();

        expect(result.ok).toBe(false);
        expect(mockedAxios).toHaveBeenCalledTimes(1); // still 1 — no second request
    });
});
