import { checkImageSignature } from './k8sAdmission';
import * as store from '../services/imageStore';
import * as cosign from '../services/cosignService';

jest.mock('../services/imageStore');
jest.mock('../services/cosignService');
jest.mock('../repositories/gateRulesRepository', () => ({ gateRulesRepository: {} }));
jest.mock('../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

const mockGetSig = store.getSignature as jest.MockedFunction<typeof store.getSignature>;
const mockVerify = cosign.verifyImageDigest as jest.MockedFunction<typeof cosign.verifyImageDigest>;

const PINNED = 'registry/app@sha256:abc123';

afterEach(() => {
  delete process.env.REQUIRE_IMAGE_SIGNATURE;
  jest.clearAllMocks();
});

describe('checkImageSignature', () => {
  it('is a no-op (ready) when enforcement is off', async () => {
    const r = await checkImageSignature(PINNED, 'prod');
    expect(r.status).toBe('ready');
    expect(mockGetSig).not.toHaveBeenCalled();
  });

  it('does not enforce outside prod even when enabled', async () => {
    process.env.REQUIRE_IMAGE_SIGNATURE = 'true';
    const r = await checkImageSignature(PINNED, 'dev');
    expect(r.status).toBe('ready');
    expect(mockGetSig).not.toHaveBeenCalled();
  });

  it('blocks an image with no recorded signature (prod, enabled)', async () => {
    process.env.REQUIRE_IMAGE_SIGNATURE = 'true';
    mockGetSig.mockResolvedValue(undefined);
    const r = await checkImageSignature(PINNED, 'prod');
    expect(r.status).toBe('blocked');
    expect(r.reason).toMatch(/no signature/i);
  });

  it('blocks a non-pinned image (no digest to verify)', async () => {
    process.env.REQUIRE_IMAGE_SIGNATURE = 'true';
    const r = await checkImageSignature('registry/app:latest', 'prod');
    expect(r.status).toBe('blocked');
    expect(mockGetSig).not.toHaveBeenCalled();
  });

  it('admits a validly-signed image and verifies the right digest', async () => {
    process.env.REQUIRE_IMAGE_SIGNATURE = 'true';
    mockGetSig.mockResolvedValue('sig-blob');
    mockVerify.mockResolvedValue(true);
    const r = await checkImageSignature(PINNED, 'prod');
    expect(r.status).toBe('ready');
    expect(mockVerify).toHaveBeenCalledWith('sha256:abc123', 'sig-blob');
  });

  it('blocks when signature verification fails (tampered)', async () => {
    process.env.REQUIRE_IMAGE_SIGNATURE = 'true';
    mockGetSig.mockResolvedValue('sig-blob');
    mockVerify.mockResolvedValue(false);
    const r = await checkImageSignature(PINNED, 'prod');
    expect(r.status).toBe('blocked');
    expect(r.reason).toMatch(/verification failed/i);
  });

  it('fail-secure blocks when cosign cannot even attempt verification', async () => {
    process.env.REQUIRE_IMAGE_SIGNATURE = 'true';
    mockGetSig.mockResolvedValue('sig-blob');
    mockVerify.mockRejectedValue(new Error('COSIGN_PUB_KEY_PATH is not configured'));
    const r = await checkImageSignature(PINNED, 'prod');
    expect(r.status).toBe('blocked');
    expect(r.reason).toMatch(/cannot verify/i);
  });
});
