/**
 * toolCheck resolves scanner binaries per-platform (which vs where + Windows
 * candidate ladder). Platform is captured at module load, so each test loads
 * a fresh module copy under a faked process.platform with spawnSync mocked.
 */

jest.mock('child_process', () => ({ spawnSync: jest.fn() }));
jest.mock('../services/logger', () => ({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));

import { spawnSync } from 'child_process';

type ToolCheckModule = typeof import('./toolCheck');

const spawn = spawnSync as jest.Mock;
const realPlatform = process.platform;

const loadOnPlatform = (platform: string): ToolCheckModule => {
  Object.defineProperty(process, 'platform', { value: platform });
  let mod: ToolCheckModule;
  jest.isolateModules(() => {
    mod = require('./toolCheck');
  });
  return mod!;
};

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform });
  jest.clearAllMocks();
});

const ok = (stdout = '') => ({ status: 0, stdout: Buffer.from(stdout) });
const fail = () => ({ status: 1, stdout: Buffer.from('') });

describe('unix resolution', () => {
  it('resolves an installed tool with its version line', async () => {
    const mod = loadOnPlatform('linux');
    spawn.mockImplementation((cmd: string) => (cmd === 'which' ? ok('/usr/bin/trivy') : ok('Version: 0.55\nbuilt: today')));

    const resolved = await mod.resolveToolCommand('trivy');

    expect(resolved).toMatchObject({ cmd: 'trivy', prefixArgs: [], status: 'installed', version: 'Version: 0.55' });
  });

  it('marks a tool missing when which fails', async () => {
    const mod = loadOnPlatform('linux');
    spawn.mockReturnValue(fail());

    expect((await mod.resolveToolCommand('semgrep')).status).toBe('missing');
  });

  it('uses the bare "version" flag for gitleaks/opa/cosign', async () => {
    const mod = loadOnPlatform('linux');
    spawn.mockImplementation((cmd: string) => (cmd === 'which' ? ok('/usr/bin/gitleaks') : ok('v8')));

    await mod.resolveToolCommand('gitleaks');

    expect(spawn).toHaveBeenCalledWith('gitleaks', ['version']);
  });

  it('checkTool falls back to a synchronous which probe', () => {
    const mod = loadOnPlatform('linux');
    spawn.mockReturnValue(ok('/usr/bin/trivy'));
    expect(mod.checkTool('trivy')).toBe(true);

    spawn.mockReturnValue(fail());
    expect(mod.checkTool('nope')).toBe(false);
  });
});

describe('windows candidate ladder', () => {
  it('resolves via the first candidate that both exists and runs', async () => {
    const mod = loadOnPlatform('win32');
    // "where semgrep" fails, "where semgrep.exe" succeeds, exe runs fine
    spawn.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'where') return args[0] === 'semgrep.exe' ? ok('C:\\semgrep.exe') : fail();
      if (cmd === 'semgrep.exe') return ok('1.90.0');
      return fail();
    });

    const resolved = await mod.resolveToolCommand('semgrep');

    expect(resolved).toMatchObject({ cmd: 'semgrep.exe', status: 'installed', version: '1.90.0' });
  });

  it('falls back to missing with the checkov cmd-shim special case', async () => {
    const mod = loadOnPlatform('win32');
    spawn.mockReturnValue(fail());

    expect(await mod.resolveToolCommand('checkov')).toMatchObject({
      cmd: 'cmd', prefixArgs: ['/c', 'checkov'], status: 'missing',
    });
    expect(await mod.resolveToolCommand('trivy')).toMatchObject({ cmd: 'trivy.exe', status: 'missing' });
  });

  it('checkTool probes the candidate ladder directly', () => {
    const mod = loadOnPlatform('win32');
    spawn.mockImplementation((cmd: string) => (cmd === 'python' ? ok('bandit 1.7') : fail()));
    expect(mod.checkTool('bandit')).toBe(true);

    spawn.mockReturnValue(fail());
    expect(mod.checkTool('ghost')).toBe(false);
  });
});

describe('cache and bulk validation', () => {
  it('memoizes resolution per tool', async () => {
    const mod = loadOnPlatform('linux');
    spawn.mockImplementation((cmd: string) => (cmd === 'which' ? ok('/usr/bin/trivy') : ok('v1')));

    await mod.resolveToolCommand('trivy');
    const callsAfterFirst = spawn.mock.calls.length;
    await mod.resolveToolCommand('trivy');

    expect(spawn.mock.calls.length).toBe(callsAfterFirst);
  });

  it('checkTool consults the cache before spawning', async () => {
    const mod = loadOnPlatform('linux');
    spawn.mockImplementation((cmd: string) => (cmd === 'which' ? ok('/usr/bin/opa') : ok('v0.60')));
    await mod.resolveToolCommand('opa');
    spawn.mockClear();

    expect(mod.checkTool('opa')).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('validateTools reports installed and missing tools', async () => {
    const mod = loadOnPlatform('linux');
    spawn.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'which') return ['semgrep', 'trivy'].includes(args[0]) ? ok('/bin') : fail();
      return ok('v1');
    });

    const results = await mod.validateTools();
    const byTool = Object.fromEntries(results.map(r => [r.tool, r.status]));

    expect(byTool).toMatchObject({ semgrep: 'installed', trivy: 'installed', gitleaks: 'missing', opa: 'missing' });
    expect(results).toHaveLength(6);
  });

  it('initToolCache warms every scanner', async () => {
    const mod = loadOnPlatform('linux');
    spawn.mockReturnValue(fail());
    await mod.initToolCache();
    spawn.mockClear();

    await mod.resolveToolCommand('semgrep'); // cache hit → no new spawns
    expect(spawn).not.toHaveBeenCalled();
  });
});
