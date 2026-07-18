import { BinaryRunner } from './binaryRunner';
import { DockerRunner } from './dockerRunner';
import { BINARY_UNSUPPORTED, TOOL_IMAGES } from './types';

// Node is guaranteed present, so it stands in for a scanner binary and lets
// these assert real process behaviour rather than a mocked spawn.
const nodeRun = (args: string[]) => ({
  tool: 'node',
  args,
  workspacePath: process.cwd(),
  timeoutMs: 10_000,
});

describe('BinaryRunner', () => {
  const runner = new BinaryRunner();

  it('captures stdout and a zero exit code', async () => {
    const res = await runner.run(nodeRun(['-e', 'console.log("hello")']));
    expect(res.stdout.trim()).toBe('hello');
    expect(res.exitCode).toBe(0);
  });

  it('captures stderr and a non-zero exit code without throwing', async () => {
    // Scanners routinely exit non-zero *because* they found something — that is
    // a normal result, not a failure to run.
    const res = await runner.run(nodeRun(['-e', 'console.error("found"); process.exit(3)']));
    expect(res.stderr.trim()).toBe('found');
    expect(res.exitCode).toBe(3);
  });

  it('rejects when the binary is missing rather than returning an empty result', async () => {
    // The critical property: a scanner that never ran must never look clean.
    await expect(
      runner.run({ ...nodeRun([]), tool: 'definitely-not-a-real-binary-xyz' })
    ).rejects.toThrow();
  });

  it('reports ZAP and Falco as unsupported', () => {
    for (const tool of BINARY_UNSUPPORTED) {
      expect(runner.supports(tool)).toBe(false);
    }
  });

  it('supports every tool that has a container image except the docker-only ones', () => {
    for (const tool of Object.keys(TOOL_IMAGES)) {
      expect(runner.supports(tool)).toBe(true);
    }
  });

  it('refuses to run an unsupported tool instead of silently succeeding', async () => {
    await expect(runner.run({ ...nodeRun([]), tool: 'zap' })).rejects.toThrow(/binary mode/);
  });

  it('resolves binaries from SCORPION_BIN_DIR when set', async () => {
    const original = process.env.SCORPION_BIN_DIR;
    process.env.SCORPION_BIN_DIR = '/nonexistent-bin-dir';
    try {
      // Resolving through the pinned dir must fail rather than fall back to PATH,
      // otherwise a deployment could silently run an unpinned scanner version.
      await expect(runner.run(nodeRun(['-e', 'console.log(1)']))).rejects.toThrow();
    } finally {
      if (original === undefined) delete process.env.SCORPION_BIN_DIR;
      else process.env.SCORPION_BIN_DIR = original;
    }
  });
});

describe('DockerRunner', () => {
  it('claims support for every tool (a daemon can run any image)', () => {
    const runner = new DockerRunner();
    for (const tool of [...Object.keys(TOOL_IMAGES), ...BINARY_UNSUPPORTED]) {
      expect(runner.supports(tool)).toBe(true);
    }
  });

  it('maps every orchestrated tool to a container image', () => {
    for (const tool of ['semgrep', 'gitleaks', 'trivy', 'checkov', 'bandit', 'hadolint']) {
      expect(TOOL_IMAGES[tool]).toBeTruthy();
    }
  });
});
