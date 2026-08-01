// backend/src/scripts/smoke_container_isolation.ts
//
// Proves the isolation flags actually hold, by running real containers.
//
// RUN THIS ON A LINUX WORKER, not on a Windows or macOS dev machine. Docker
// Desktop shares bind mounts through a VM filesystem that presents permissive
// ownership, so the uid mismatch that throws EACCES in production usually does
// not reproduce locally. A green run there proves almost nothing about the
// thing most likely to break.
//
// Needs only a Docker daemon and the alpine image. Touches no database.
//
// Run (from backend/):
//   npm run build && node dist/backend/src/scripts/smoke_container_isolation.js
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ContainerTimeoutError, dockerRunnerService } from '../services/dockerRunnerService';
import { resolveUser } from '../services/runner/hostConfig';

const IMAGE = 'alpine:3.20';

let failures = 0;
const check = (ok: boolean, msg: string): void => {
  if (ok) console.log(`  [PASS] ${msg}`);
  else { failures += 1; console.error(`  [FAIL] ${msg}`); }
};

/** Collects container output so an assertion can be made about what ran. */
function sink(): { log: (m: string) => void; text: () => string } {
  const lines: string[] = [];
  return { log: (m: string) => lines.push(m), text: () => lines.join('\n') };
}

async function main(): Promise<void> {
  console.log(`Container isolation smoke test (image ${IMAGE})`);
  console.log(`Platform ${os.platform()} — on Windows/macOS the bind-mount ownership check is not meaningful.\n`);

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-isolation-'));
  console.log(`workspace ${workspace}`);
  console.log(`resolved container user: ${resolveUser(workspace, undefined, (m) => console.log(`  ${m}`))}\n`);

  try {
    // THE question this script exists for: can the unprivileged container write
    // back to the bind-mounted workspace, or does every build die on EACCES?
    console.log('Workspace write-back:');
    const write = sink();
    const wrote = await dockerRunnerService.runInContainer({
      image: IMAGE, entrypoint: ['/bin/sh', '-c'],
      cmd: ['echo written-by-container > /workspace/proof.txt && cat /workspace/proof.txt'],
      workspacePath: workspace, logger: write, timeoutMs: 60_000,
    });
    check(wrote.exitCode === 0, `container wrote to the workspace (exit ${wrote.exitCode})`);
    check(fs.existsSync(path.join(workspace, 'proof.txt')), 'the file is visible on the host');
    if (wrote.exitCode !== 0) console.error(`         output: ${write.text()}`);

    console.log('\nIdentity:');
    const id = sink();
    await dockerRunnerService.runInContainer({
      image: IMAGE, entrypoint: ['/bin/sh', '-c'], cmd: ['id -u'],
      workspacePath: workspace, logger: id, timeoutMs: 60_000,
    });
    check(!/^0$/m.test(id.text()), `container is not running as root (id -u => ${id.text().trim()})`);

    console.log('\nNetwork:');
    const denied = sink();
    const noNet = await dockerRunnerService.runInContainer({
      image: IMAGE, entrypoint: ['/bin/sh', '-c'],
      // A DNS lookup is enough; nothing resolves with no network namespace.
      cmd: ['getent hosts example.com && echo RESOLVED || echo BLOCKED'],
      workspacePath: workspace, logger: denied, timeoutMs: 60_000,
    });
    check(denied.text().includes('BLOCKED'), `egress denied by default (exit ${noNet.exitCode})`);

    const allowed = sink();
    await dockerRunnerService.runInContainer({
      image: IMAGE, entrypoint: ['/bin/sh', '-c'],
      cmd: ['getent hosts example.com >/dev/null && echo RESOLVED || echo BLOCKED'],
      workspacePath: workspace, logger: allowed, allowEgress: true, timeoutMs: 60_000,
    });
    check(allowed.text().includes('RESOLVED'), 'egress works when explicitly requested');

    console.log('\nPrivilege:');
    const caps = sink();
    await dockerRunnerService.runInContainer({
      image: IMAGE, entrypoint: ['/bin/sh', '-c'],
      // Binding a low port needs CAP_NET_BIND_SERVICE, which CapDrop removed.
      cmd: ['nc -l -p 80 -w 1 2>&1 || echo CAP_DENIED'],
      workspacePath: workspace, logger: caps, timeoutMs: 60_000, user: null,
    });
    check(caps.text().includes('CAP_DENIED'), 'capabilities are dropped even when running as the image user');

    console.log('\nLimits:');
    const pids = sink();
    await dockerRunnerService.runInContainer({
      image: IMAGE, entrypoint: ['/bin/sh', '-c'],
      cmd: ['cat /sys/fs/cgroup/pids.max 2>/dev/null || cat /sys/fs/cgroup/pids/pids.max'],
      workspacePath: workspace, logger: pids, timeoutMs: 60_000,
    });
    check(/\b512\b/.test(pids.text()), `PID limit applied (${pids.text().trim()})`);

    console.log('\nTimeout:');
    const slow = sink();
    const started = Date.now();
    let timedOut = false;
    try {
      await dockerRunnerService.runInContainer({
        image: IMAGE, entrypoint: ['/bin/sh', '-c'], cmd: ['sleep 120'],
        workspacePath: workspace, logger: slow, timeoutMs: 5_000,
      });
    } catch (err) {
      timedOut = err instanceof ContainerTimeoutError;
    }
    const elapsed = Date.now() - started;
    check(timedOut, 'a hanging container raises ContainerTimeoutError');
    check(elapsed < 60_000, `it was killed promptly (${Math.round(elapsed / 1000)}s, budget 5s)`);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    console.log(`\nCleaned up ${workspace}`);
  }

  console.log('');
  if (failures > 0) { console.error(`FAILED — ${failures} check(s).`); process.exit(1); }
  console.log('PASSED — isolation holds and the workspace is still writable.');
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
