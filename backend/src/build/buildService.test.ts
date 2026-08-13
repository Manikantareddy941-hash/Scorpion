/**
 * First tests for buildService (#190). This file had none, so the rethrow that
 * decides whether a broken signer fails a build had only the compiler checking
 * it — in a module that duplicates pipelineService, which is exactly how the two
 * copies drifted apart in the first place.
 *
 * startBuild returns its pipelineId immediately and finishes the work in a
 * floating async IIFE, so every case here waits on the terminal status write
 * rather than on startBuild's own promise.
 */

const updateDocument = jest.fn();
const createDocument = jest.fn();
const getDocument = jest.fn();

jest.mock('../lib/appwrite', () => ({
  databases: {
    getDocument: (...a: unknown[]) => getDocument(...a),
    createDocument: (...a: unknown[]) => createDocument(...a),
    updateDocument: (...a: unknown[]) => updateDocument(...a),
  },
  COLLECTIONS: { REPOSITORIES: 'repositories', BUILD_PIPELINES: 'build_pipelines' },
  DB_ID: 'test-db',
  ID: { unique: () => 'pipeline-1' },
}));

jest.mock('../utils/git', () => ({ cloneRepo: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../scanners/pipeline', () => ({ runScanPipeline: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/auditService', () => ({ auditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../services/metrics', () => ({
  buildsTotal: { labels: () => ({ inc: jest.fn() }) },
  buildDuration: { labels: () => ({ observe: jest.fn() }) },
}));

// Not a factory-replacement of the whole module: errorContext/errorMessage are
// real exports this service calls, and a bare factory would make them undefined.
jest.mock('../services/logger', () => ({
  ...jest.requireActual('../services/logger'),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const getImageDigest = jest.fn();
const signImageDigest = jest.fn();
class CosignSigningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CosignSigningError';
  }
}
jest.mock('../services/cosignService', () => ({
  getImageDigest: (...a: unknown[]) => getImageDigest(...a),
  signImageDigest: (...a: unknown[]) => signImageDigest(...a),
  CosignSigningError,
}));

const attestProvenance = jest.fn();
jest.mock('../services/provenanceService', () => ({
  attestProvenance: (...a: unknown[]) => attestProvenance(...a),
}));

const putProvenance = jest.fn().mockResolvedValue(undefined);
jest.mock('../services/imageStore', () => ({
  putProvenance: (...a: unknown[]) => putProvenance(...a),
}));

// A Dockerfile in the workspace selects the docker path, which is the only one
// that signs and attests.
jest.mock('fs/promises', () => ({
  readdir: jest.fn().mockResolvedValue(['Dockerfile']),
  rm: jest.fn().mockResolvedValue(undefined),
}));

/**
 * util.promisify(exec) resolves to the FIRST callback value, because this mock
 * does not carry exec's promisify.custom symbol. So the callback hands back a
 * single { stdout, stderr } object, which is what the service destructures.
 */
type ExecCb = (err: Error | null, value?: { stdout: string; stderr: string }) => void;
let execImpl: (command: string, cb: ExecCb) => void = (_command, cb) =>
  cb(null, { stdout: 'sha-out', stderr: '' });

jest.mock('child_process', () => ({
  exec: (command: string, _opts: unknown, cb: ExecCb) => execImpl(command, cb),
}));

import { startBuild } from './buildService';
import { CosignSigningError as RealCosignSigningError } from '../services/cosignService';

/** Resolves with the terminal update payload — the one carrying finishedAt. */
function finalStatus(): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    updateDocument.mockImplementation((_db, _col, _id, payload: Record<string, unknown>) => {
      if (payload && 'finishedAt' in payload) resolve(payload);
      return Promise.resolve({});
    });
  });
}

const SIGNED = { signature: 'sig-abc' };
const STATEMENT = { statement: { subject: [{ digest: { sha256: 'abc' } }] }, signature: 'sig-abc' };

beforeEach(() => {
  jest.clearAllMocks();
  execImpl = (_command, cb) => cb(null, { stdout: 'sha-out', stderr: '' });
  getDocument.mockResolvedValue({ url: 'https://github.com/acme/app.git', name: 'app' });
  createDocument.mockResolvedValue({ $id: 'pipeline-1' });
  updateDocument.mockResolvedValue({});
  getImageDigest.mockResolvedValue('sha256:abc');
  signImageDigest.mockResolvedValue(SIGNED);
  attestProvenance.mockResolvedValue(STATEMENT);
  putProvenance.mockResolvedValue(undefined);
});

describe('startBuild — docker path', () => {
  it('signs, attests, and persists provenance to the build record and the cache', async () => {
    const done = finalStatus();
    await startBuild('repo-1', 'main', 'user@acme.test');
    const payload = await done;

    expect(payload.status).toBe('success');

    // The durable copy the deploy gate reads. Redis alone is a 1h TTL, so this
    // write is what makes provenance survive to deploy time.
    expect(updateDocument).toHaveBeenCalledWith(
      'test-db', 'build_pipelines', 'pipeline-1',
      { provenance: JSON.stringify(STATEMENT) },
    );
    // The hot path still gets it.
    expect(putProvenance).toHaveBeenCalledWith(null, 'sha256:abc', JSON.stringify(STATEMENT));
    // Signed against the digest that was actually built.
    expect(attestProvenance).toHaveBeenCalledWith(
      expect.objectContaining({ imageDigest: 'sha256:abc', branch: 'main' }),
    );
  });

  it('records provenance for the same digest it signed', async () => {
    const done = finalStatus();
    await startBuild('repo-1', 'main', 'user@acme.test');
    await done;

    expect(signImageDigest).toHaveBeenCalledWith('sha256:abc');
    expect(attestProvenance.mock.calls[0][0].imageDigest).toBe('sha256:abc');
  });

  /** Opt-out, not failure — the distinction the deploy gate depends on. */
  it('skips signing and provenance when cosign is not configured', async () => {
    signImageDigest.mockResolvedValue(null);
    attestProvenance.mockResolvedValue(null);

    const done = finalStatus();
    await startBuild('repo-1', 'main', 'user@acme.test');
    const payload = await done;

    expect(payload.status).toBe('success');
    expect(putProvenance).not.toHaveBeenCalled();
    expect(updateDocument).not.toHaveBeenCalledWith(
      'test-db', 'build_pipelines', 'pipeline-1',
      expect.objectContaining({ provenance: expect.anything() }),
    );
  });

  /**
   * The rethrow #190 names. A pipeline configured to sign that cannot sign must
   * fail: an unsigned image from a host that meant to sign is indistinguishable
   * downstream from one that never claimed to, and that one deploys freely.
   */
  it('fails the build when a configured signer breaks', async () => {
    signImageDigest.mockRejectedValue(new RealCosignSigningError('cosign exited 1'));

    const done = finalStatus();
    await startBuild('repo-1', 'main', 'user@acme.test');
    const payload = await done;

    expect(payload.status).toBe('failed');
    expect(String(payload.logs)).toContain('Image signing failed');
  });

  /** Everything else in that block is best-effort and must not fail the build. */
  it('does not fail the build when the digest step breaks for another reason', async () => {
    getImageDigest.mockRejectedValue(new Error('docker inspect: no such image'));

    const done = finalStatus();
    await startBuild('repo-1', 'main', 'user@acme.test');
    const payload = await done;

    expect(payload.status).toBe('success');
  });

  /**
   * Provenance is capped at 16KB and Appwrite rejects the whole write on
   * oversize. Losing a signed, scanned build to save the metadata about it would
   * be the wrong trade — the gate reads a missing statement as absent.
   */
  it('still succeeds when the provenance column write is rejected', async () => {
    const finished = new Promise<Record<string, unknown>>((resolve) => {
      updateDocument.mockImplementation((_db, _col, _id, payload: Record<string, unknown>) => {
        if (payload && 'provenance' in payload) return Promise.reject(new Error('attribute too large'));
        if (payload && 'finishedAt' in payload) { resolve(payload); return Promise.resolve({}); }
        return Promise.resolve({});
      });
    });

    await startBuild('repo-1', 'main', 'user@acme.test');
    const payload = await finished;

    expect(payload.status).toBe('success');
    // Cache write still happens; the durable one is what failed.
    expect(putProvenance).toHaveBeenCalled();
  });
});

describe('startBuild — failure reporting', () => {
  /**
   * The regression BuildCommandError exists for: the old rethrow spread the
   * error into an object literal, which drops message and stack because V8
   * marks both non-enumerable, and the transcript arrived with no reason.
   */
  it('keeps the command transcript and the reason when a build command fails', async () => {
    execImpl = (command, cb) => {
      if (command.startsWith('docker build')) {
        cb(Object.assign(new Error('exit status 1'), { stdout: 'step 1/4', stderr: 'no such file' }));
        return;
      }
      cb(null, { stdout: 'sha-out', stderr: '' });
    };

    const done = finalStatus();
    await startBuild('repo-1', 'main', 'user@acme.test');
    const payload = await done;

    expect(payload.status).toBe('failed');
    const logs = String(payload.logs);
    expect(logs).toContain('docker build');
    expect(logs).toContain('exit status 1');
    // The stderr the command emitted, not just the exit code.
    expect(logs).toContain('no such file');
  });

  it('throws rather than reporting a pipeline when the repository is missing', async () => {
    getDocument.mockRejectedValue(new Error('document not found'));

    await expect(startBuild('missing-repo', 'main', 'user@acme.test')).rejects.toThrow(
      /Failed to find repository/,
    );
    expect(createDocument).not.toHaveBeenCalled();
  });
});
