jest.mock('../lib/appwrite', () => ({
  databases: { getDocument: jest.fn(), updateDocument: jest.fn() },
  DB_ID: 'db', COLLECTIONS: { INCIDENTS: 'incidents' },
}));
jest.mock('../repositories/planRepository', () => ({
  planRepository: { createIssue: jest.fn(), getProjectOwner: jest.fn(), getProject: jest.fn() },
}));
// Plan access is the union check now (owner OR team), so the guard runs through
// getProject + canAccessResource rather than owner equality.
jest.mock('./tenancyService', () => ({ canAccessResource: jest.fn(), canAccessIncident: jest.fn() }));
import { databases } from '../lib/appwrite';
import { planRepository } from '../repositories/planRepository';
import { canAccessResource, canAccessIncident } from './tenancyService';
import { buildIncidentIssueFields, convertIncidentToIssue, IncidentDoc } from './incidentFeedbackService';

const incident: IncidentDoc = {
  $id: 'inc1', title: 'Account takeover on API', severity: 'critical', user_id: 'u1',
  status: 'resolved', rootCause: 'Missing rate limit', escapedPhase: 'test',
  lessons: 'add rate-limit tests\nenable lockout',
};

test('buildIncidentIssueFields maps postmortem to a security story', () => {
  const issue = buildIncidentIssueFields(incident, 'p1');
  expect(issue.type).toBe('story');
  expect(issue.title).toBe('[Post-mortem] Account takeover on API');
  expect(issue.priority).toBe('critical');
  expect(issue.labels).toEqual(['security', 'incident-response', 'escaped:test']);
  expect(issue.description).toContain('Missing rate limit');
  expect(issue.description).toContain('- [ ] add rate-limit tests');
  expect(issue.description).toContain('- [ ] enable lockout');
});

describe('convertIncidentToIssue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (planRepository.getProject as jest.Mock).mockResolvedValue({ $id: 'p1', user_id: 'u1', team_id: null });
    (canAccessResource as jest.Mock).mockResolvedValue(true);
    (canAccessIncident as jest.Mock).mockResolvedValue(true);
    (databases.getDocument as jest.Mock).mockResolvedValue(incident);
    (planRepository.createIssue as jest.Mock).mockImplementation(async (i) => i);
  });

  test('creates issue and writes actionItemIssueId back', async () => {
    const out = await convertIncidentToIssue('p1', 'inc1', 'u1');
    expect(out).toMatchObject({ ok: true });
    expect(planRepository.createIssue).toHaveBeenCalled();
    expect(databases.updateDocument).toHaveBeenCalledWith('db', 'incidents', 'inc1',
      expect.objectContaining({ actionItemIssueId: expect.any(String) }));
  });

  test('idempotent: existing actionItemIssueId returns it without creating', async () => {
    (databases.getDocument as jest.Mock).mockResolvedValue({ ...incident, actionItemIssueId: 'issue-9' });
    const out = await convertIncidentToIssue('p1', 'inc1', 'u1');
    expect(out).toEqual({ ok: true, issueId: 'issue-9' });
    expect(planRepository.createIssue).not.toHaveBeenCalled();
  });

  test('forbidden when caller does not own the plan project', async () => {
    (planRepository.getProject as jest.Mock).mockResolvedValue({ $id: 'p1', user_id: 'someone-else', team_id: null });
    (canAccessResource as jest.Mock).mockResolvedValue(false);
    expect(await convertIncidentToIssue('p1', 'inc1', 'u1')).toBe('forbidden');
  });

  test('forbidden when caller does not own the incident', async () => {
    (databases.getDocument as jest.Mock).mockResolvedValue({ ...incident, user_id: 'other' });
    (canAccessIncident as jest.Mock).mockResolvedValue(false);
    expect(await convertIncidentToIssue('p1', 'inc1', 'u1')).toBe('forbidden');
  });

  test('not_found when the incident fetch fails', async () => {
    (databases.getDocument as jest.Mock).mockRejectedValue(new Error('document not found'));
    expect(await convertIncidentToIssue('p1', 'inc1', 'u1')).toBe('not_found');
    expect(planRepository.createIssue).not.toHaveBeenCalled();
  });

  test('not_resolved and no_postmortem guards', async () => {
    (databases.getDocument as jest.Mock).mockResolvedValue({ ...incident, status: 'open' });
    expect(await convertIncidentToIssue('p1', 'inc1', 'u1')).toBe('not_resolved');
    (databases.getDocument as jest.Mock).mockResolvedValue({ ...incident, rootCause: undefined });
    expect(await convertIncidentToIssue('p1', 'inc1', 'u1')).toBe('no_postmortem');
  });
});
