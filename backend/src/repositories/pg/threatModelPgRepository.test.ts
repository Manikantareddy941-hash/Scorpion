import { describeDb, truncateAll } from '../../db/testDb';
import { closePool } from '../../db/pool';
import { threatModelPgRepository } from './threatModelPgRepository';

const model = (createdBy: string, name = 'Model') => ({
  name,
  description: 'desc',
  diagramData: '{}',
  threats: '[]',
  createdBy,
  status: 'draft',
});

describeDb('threatModelPgRepository', () => {
  beforeEach(() => truncateAll(['threat_models']));
  afterAll(() => closePool());

  it('ensureCollection is a no-op', async () => {
    await expect(threatModelPgRepository.ensureCollection()).resolves.toBeUndefined();
  });

  it('creates a model with an Appwrite-shaped id and createdAt', async () => {
    const created = await threatModelPgRepository.create(model('u1'));
    expect(created.$id).toBeTruthy();
    expect(created.$createdAt).toBeTruthy();
    expect(created.name).toBe('Model');
  });

  it('get returns a stored model and rejects a missing id', async () => {
    const created = await threatModelPgRepository.create(model('u1'));
    expect((await threatModelPgRepository.get(created.$id)).createdBy).toBe('u1');
    await expect(threatModelPgRepository.get('missing')).rejects.toThrow('document not found');
  });

  it('list scopes to the creator when a userId is given', async () => {
    await threatModelPgRepository.create(model('u1', 'A'));
    await threatModelPgRepository.create(model('u2', 'B'));
    expect(await threatModelPgRepository.list('u1')).toHaveLength(1);
    expect(await threatModelPgRepository.list()).toHaveLength(2);
  });

  it('update merges fields; remove deletes', async () => {
    const created = await threatModelPgRepository.create(model('u1'));
    await threatModelPgRepository.update(created.$id, { status: 'final' });
    expect((await threatModelPgRepository.get(created.$id)).status).toBe('final');
    await threatModelPgRepository.remove(created.$id);
    await expect(threatModelPgRepository.get(created.$id)).rejects.toThrow('document not found');
  });
});
