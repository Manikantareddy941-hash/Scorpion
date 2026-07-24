jest.mock('../repositories/planRepository', () => ({
  planRepository: { getProjectOwner: jest.fn() },
}));
jest.mock('../repositories/securityRequirementsRepository', () => ({
  securityRequirementsRepository: {
    getProfile: jest.fn(), upsertProfile: jest.fn(), listRequirements: jest.fn(),
    applyReconcile: jest.fn(), getRequirement: jest.fn(), updateRequirement: jest.fn(),
    setTicketRef: jest.fn(),
  },
}));
jest.mock('./ticketsService', () => ({ ticketsService: { createTicket: jest.fn() } }));
jest.mock('./jiraService', () => ({ pushTicketToJira: jest.fn() }));

import { securityRequirementsService as svc } from './securityRequirementsService';
import { planRepository } from '../repositories/planRepository';
import { securityRequirementsRepository as repo } from '../repositories/securityRequirementsRepository';
import { ticketsService } from './ticketsService';
import { pushTicketToJira } from './jiraService';

const owner = planRepository.getProjectOwner as jest.Mock;
const mockRepo = repo as unknown as Record<string, jest.Mock>;
const ticketsCreate = ticketsService.createTicket as jest.Mock;
const jiraPush = pushTicketToJira as jest.Mock;

describe('securityRequirementsService tenant isolation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('denies list when the caller does not own the project', async () => {
    owner.mockResolvedValue('someone-else');
    const res = await svc.list('p1', 'user-1');
    expect(res).toBe('denied');
    expect(mockRepo.listRequirements).not.toHaveBeenCalled();
  });

  it('returns requirements when the caller owns the project', async () => {
    owner.mockResolvedValue('user-1');
    mockRepo.listRequirements.mockResolvedValue([{ code: 'REQ-A' }]);
    const res = await svc.list('p1', 'user-1');
    expect(res).toEqual({ ok: true, data: [{ code: 'REQ-A' }] });
  });

  it('denies when no user id is present', async () => {
    const res = await svc.list('p1', undefined);
    expect(res).toBe('denied');
    expect(owner).not.toHaveBeenCalled();
  });

  it('setLifecycle answers not_found (not forbidden) when the requirement is another tenant\'s', async () => {
    mockRepo.getRequirement.mockResolvedValue({ $id: 'r1', projectId: 'p1' });
    owner.mockResolvedValue('someone-else');
    const res = await svc.setLifecycle('r1', { lifecycleStatus: 'satisfied' }, 'user-1', 'e@x');
    expect(res).toBe('not_found');
    expect(mockRepo.updateRequirement).not.toHaveBeenCalled();
  });

  it('setLifecycle writes updatedBy from the session when owned', async () => {
    mockRepo.getRequirement.mockResolvedValue({ $id: 'r1', projectId: 'p1' });
    owner.mockResolvedValue('user-1');
    mockRepo.updateRequirement.mockResolvedValue({ $id: 'r1', lifecycleStatus: 'waived' });
    await svc.setLifecycle('r1', { lifecycleStatus: 'waived', justification: 'ok' }, 'user-1', 'auditor@x');
    expect(mockRepo.updateRequirement).toHaveBeenCalledWith('r1', {
      lifecycleStatus: 'waived', justification: 'ok', updatedBy: 'auditor@x',
    });
  });

  it('generate returns no_profile when the project has no profile yet', async () => {
    owner.mockResolvedValue('user-1');
    mockRepo.getProfile.mockResolvedValue(null);
    const res = await svc.generate('p1', 'user-1');
    expect(res).toBe('no_profile');
    expect(mockRepo.applyReconcile).not.toHaveBeenCalled();
  });

  it('saveProfile stamps projectId from the path, not the body', async () => {
    owner.mockResolvedValue('user-1');
    mockRepo.upsertProfile.mockImplementation(async (p) => p);
    await svc.saveProfile('p1', { appType: 'api', stack: ['node'], dataTypes: ['card'], deployment: 'cloud', authModel: 'session', frameworks: ['PCI DSS'] }, 'user-1');
    expect(mockRepo.upsertProfile).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }));
  });
});

describe('securityRequirementsService.pushToTicket (3a bridge)', () => {
  beforeEach(() => jest.clearAllMocks());

  const requirement = (over = {}) => ({
    $id: 'r1', projectId: 'p1', code: 'REQ-PCI-6.5.1-SQLI', title: 'Prevent injection',
    description: 'desc', category: 'Secure Coding', frameworks: ['PCI DSS', 'SOC 2'],
    controlIds: ['PCI DSS 6.5.1', 'CC6.1'], severity: 'high', status: 'required',
    lifecycleStatus: 'open', remediation: 'Use parameterized queries', sourceRuleId: ['pci'],
    createdAt: '2026-01-01', ...over,
  });
  const ownership = { user_id: 'user-1', team_id: null };

  it('returns not_found when the requirement is another tenant\'s', async () => {
    mockRepo.getRequirement.mockResolvedValue(requirement());
    owner.mockResolvedValue('someone-else');
    const res = await svc.pushToTicket('r1', 'user-1', 'e@x', ownership);
    expect(res).toBe('not_found');
    expect(ticketsCreate).not.toHaveBeenCalled();
  });

  it('creates a labelled ticket, pushes to Jira, and stores the refs', async () => {
    mockRepo.getRequirement.mockResolvedValue(requirement());
    owner.mockResolvedValue('user-1');
    ticketsCreate.mockResolvedValue({ conflict: false, ticket: { id: 'tk1' } });
    jiraPush.mockResolvedValue({ ok: true, jiraKey: 'SEC-42' });

    const res = await svc.pushToTicket('r1', 'user-1', 'auditor@x', ownership);

    expect(res).toEqual({ ok: true, alreadyLinked: false, ticketId: 'tk1', jiraKey: 'SEC-42' });
    const [input, reporter, own] = ticketsCreate.mock.calls[0];
    expect(input.priority).toBe('high');
    expect(input.tags).toEqual(expect.arrayContaining(['scorpion-security', 'compliance', 'pci-dss', 'soc-2', 'req-pci-6.5.1-sqli']));
    expect(input.description).toContain('PCI DSS 6.5.1');
    expect(input.description).toContain('Use parameterized queries');
    expect(reporter).toBe('auditor@x');
    expect(own).toEqual(ownership);
    expect(jiraPush).toHaveBeenCalledWith('tk1');
    expect(mockRepo.setTicketRef).toHaveBeenCalledWith('r1', { ticketId: 'tk1', jiraKey: 'SEC-42' });
  });

  it('is idempotent — a requirement already linked returns the existing ticket', async () => {
    mockRepo.getRequirement.mockResolvedValue(requirement({ ticketId: 'tk-existing', jiraKey: 'SEC-9' }));
    owner.mockResolvedValue('user-1');
    const res = await svc.pushToTicket('r1', 'user-1', 'e@x', ownership);
    expect(res).toEqual({ ok: true, alreadyLinked: true, ticketId: 'tk-existing', jiraKey: 'SEC-9' });
    expect(ticketsCreate).not.toHaveBeenCalled();
  });

  it('still creates the local ticket when Jira is not configured', async () => {
    mockRepo.getRequirement.mockResolvedValue(requirement({ frameworks: ['GDPR'], controlIds: ['GDPR Art. 32'] }));
    owner.mockResolvedValue('user-1');
    ticketsCreate.mockResolvedValue({ conflict: false, ticket: { id: 'tk2' } });
    jiraPush.mockResolvedValue({ ok: false, error: 'Jira not configured' });

    const res = await svc.pushToTicket('r1', 'user-1', 'e@x', ownership);

    expect(res).toEqual({ ok: true, alreadyLinked: false, ticketId: 'tk2', jiraKey: undefined });
    expect(mockRepo.setTicketRef).toHaveBeenCalledWith('r1', { ticketId: 'tk2', jiraKey: undefined });
  });
});
