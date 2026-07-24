jest.mock('../repositories/planRepository', () => ({
  planRepository: { getProjectOwner: jest.fn() },
}));
jest.mock('../repositories/securityRequirementsRepository', () => ({
  securityRequirementsRepository: {
    getProfile: jest.fn(), upsertProfile: jest.fn(), listRequirements: jest.fn(),
    applyReconcile: jest.fn(), getRequirement: jest.fn(), updateRequirement: jest.fn(),
  },
}));

import { securityRequirementsService as svc } from './securityRequirementsService';
import { planRepository } from '../repositories/planRepository';
import { securityRequirementsRepository as repo } from '../repositories/securityRequirementsRepository';

const owner = planRepository.getProjectOwner as jest.Mock;
const mockRepo = repo as unknown as Record<string, jest.Mock>;

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
