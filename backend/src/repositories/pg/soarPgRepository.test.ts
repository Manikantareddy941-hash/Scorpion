import { describeDb, truncateAll } from '../../db/testDb';
import { closePool } from '../../db/pool';
import { soarPgRepository } from './soarPgRepository';
import type { SoarActionRecord } from '../soarRepository';

const playbook = {
  name: 'quarantine-crypto-miner',
  enabled: true,
  trigger: { rulePattern: 'crypto', minPriority: 'Warning' as const },
  actions: [{ type: 'isolate_pod' as const, mode: 'approval' as const }],
};

const action: Omit<SoarActionRecord, 'id' | 'createdAt'> = {
  incidentId: 'inc-1',
  actionType: 'isolate_pod',
  playbookId: 'pb-1',
  playbookName: 'quarantine-crypto-miner',
  status: 'pending',
  containerImage: 'nginx:1.25',
  falcoRule: 'Terminal shell in container',
};

describeDb('soarPgRepository', () => {
  beforeEach(() => truncateAll(['playbooks', 'soar_actions']));
  afterAll(() => closePool());

  it('creates a playbook and reads back the structured trigger/actions', async () => {
    const created = await soarPgRepository.createPlaybook(playbook);
    const [found] = await soarPgRepository.listPlaybooks();
    expect(found.id).toBe(created.id);
    expect(found.trigger).toEqual(playbook.trigger);
    expect(found.actions).toEqual(playbook.actions);
  });

  it('updatePlaybook patches only the fields supplied', async () => {
    const created = await soarPgRepository.createPlaybook(playbook);
    await soarPgRepository.updatePlaybook(created.id, { enabled: false });
    const [found] = await soarPgRepository.listPlaybooks();
    expect(found.enabled).toBe(false);
    expect(found.name).toBe(playbook.name); // untouched
    expect(found.actions).toEqual(playbook.actions);
  });

  it('createAction stamps createdAt and getAction round-trips optional fields', async () => {
    const created = await soarPgRepository.createAction(action);
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const found = await soarPgRepository.getAction(created.id);
    expect(found).toEqual(created);
    expect(found?.namespace).toBeUndefined(); // NULL maps back to undefined, not null
  });

  it('getAction returns null for an unknown id', async () => {
    expect(await soarPgRepository.getAction('does-not-exist')).toBeNull();
  });

  it('listActions filters by status', async () => {
    await soarPgRepository.createAction(action);
    await soarPgRepository.createAction({ ...action, incidentId: 'inc-2', status: 'executed' });
    const pending = await soarPgRepository.listActions('pending');
    expect(pending).toHaveLength(1);
    expect(pending[0].incidentId).toBe('inc-1');
    expect(await soarPgRepository.listActions()).toHaveLength(2);
  });

  it('setActionStatus preserves fields the caller omitted', async () => {
    const created = await soarPgRepository.createAction(action);
    await soarPgRepository.setActionStatus(created.id, 'approved', { resolvedBy: 'alice' });
    await soarPgRepository.setActionStatus(created.id, 'executed', { result: 'pod isolated' });
    const found = await soarPgRepository.getAction(created.id);
    expect(found?.status).toBe('executed');
    expect(found?.result).toBe('pod isolated');
    expect(found?.resolvedBy).toBe('alice'); // not clobbered by the second call
  });

  it('listEvidenceForIncident returns only capture_evidence rows for that incident', async () => {
    await soarPgRepository.createAction(action); // isolate_pod — excluded
    await soarPgRepository.createAction({ ...action, actionType: 'capture_evidence', result: 'dump.tar' });
    await soarPgRepository.createAction({ ...action, incidentId: 'inc-9', actionType: 'capture_evidence' });
    const evidence = await soarPgRepository.listEvidenceForIncident('inc-1');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].result).toBe('dump.tar');
  });
});
