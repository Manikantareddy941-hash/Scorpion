import { buildHostConfig, defaultUser, timeoutMs } from './hostConfig';

const WS = '/host/workspace';

const ENV_KEYS = ['RUNNER_MEMORY_MB', 'RUNNER_PIDS_LIMIT', 'RUNNER_CPUS', 'RUNNER_TIMEOUT_MS', 'RUNNER_USER'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('network', () => {
  test('denies egress by default', () => {
    // The scanners analyse hostile code. A default-open socket makes
    // exfiltration a plain HTTP call from a malicious build script.
    expect(buildHostConfig(WS).NetworkMode).toBe('none');
  });

  test('grants egress only when explicitly requested', () => {
    expect(buildHostConfig(WS, { allowEgress: true }).NetworkMode).toBe('bridge');
  });
});

describe('privilege', () => {
  test('drops every capability and blocks privilege escalation', () => {
    const cfg = buildHostConfig(WS);

    expect(cfg.CapDrop).toEqual(['ALL']);
    expect(cfg.SecurityOpt).toEqual(['no-new-privileges']);
  });

  test('runs unprivileged by default', () => {
    expect(defaultUser()).toBe('1000:1000');
  });

  test('the user is overridable without a code change', () => {
    // An image that genuinely cannot run unprivileged must not require a deploy
    // to unblock.
    process.env.RUNNER_USER = '2000:2000';
    expect(defaultUser()).toBe('2000:2000');
  });
});

describe('resource limits', () => {
  test('caps memory, PIDs and CPU', () => {
    const cfg = buildHostConfig(WS);

    expect(cfg.Memory).toBe(2048 * 1024 * 1024);
    expect(cfg.PidsLimit).toBe(512);
    expect(cfg.NanoCpus).toBe(2_000_000_000);
  });

  test('swap equals memory, so the limit cannot be sidestepped', () => {
    // MemorySwap above Memory lets a bomb spill into swap and still exhaust
    // the host.
    const cfg = buildHostConfig(WS);
    expect(cfg.MemorySwap).toBe(cfg.Memory);
  });

  test('limits are tunable by environment', () => {
    process.env.RUNNER_MEMORY_MB = '512';
    process.env.RUNNER_PIDS_LIMIT = '64';

    const cfg = buildHostConfig(WS);
    expect(cfg.Memory).toBe(512 * 1024 * 1024);
    expect(cfg.PidsLimit).toBe(64);
  });

  test('a nonsense limit falls back to the default rather than to unlimited', () => {
    // Docker treats 0 as unlimited, so a bad env var must never reach it.
    process.env.RUNNER_MEMORY_MB = 'not-a-number';
    process.env.RUNNER_PIDS_LIMIT = '-5';

    const cfg = buildHostConfig(WS);
    expect(cfg.Memory).toBe(2048 * 1024 * 1024);
    expect(cfg.PidsLimit).toBe(512);
  });
});

describe('mounts', () => {
  test('mounts the workspace and nothing else by default', () => {
    expect(buildHostConfig(WS).Binds).toEqual(['/host/workspace:/workspace']);
  });

  test('extra binds are appended, so a warmed cache can be attached read-only', () => {
    const cfg = buildHostConfig(WS, { extraBinds: ['/cache/trivy:/trivy-cache:ro'] });

    expect(cfg.Binds).toEqual(['/host/workspace:/workspace', '/cache/trivy:/trivy-cache:ro']);
  });
});

describe('read-only root', () => {
  test('is off by default, since it breaks images that write outside the workspace', () => {
    const cfg = buildHostConfig(WS);

    expect(cfg.ReadonlyRootfs).toBeUndefined();
    expect(cfg.Tmpfs).toBeUndefined();
  });

  test('when enabled, the writable scratch space is noexec', () => {
    // A read-only root is worth little if the tmpfs it forces everything into
    // can host a dropped binary.
    const cfg = buildHostConfig(WS, { readonlyRootfs: true });

    expect(cfg.ReadonlyRootfs).toBe(true);
    expect(cfg.Tmpfs?.['/tmp']).toContain('noexec');
    expect(cfg.Tmpfs?.['/tmp']).toContain('nosuid');
  });
});

test('the wall-clock budget defaults to 15 minutes and is tunable', () => {
  expect(timeoutMs()).toBe(15 * 60_000);
  process.env.RUNNER_TIMEOUT_MS = '30000';
  expect(timeoutMs()).toBe(30_000);
});
