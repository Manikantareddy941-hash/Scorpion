// backend/src/scripts/smoke_k8s_job_runner.ts
//
// Proves the Kubernetes Job dispatcher against a real API server and kubelet.
//
// The unit tests assert the Job spec as a data structure. That only shows what
// we ASKED for. This shows what the cluster actually enforced — a spec the API
// server accepts can still be silently ignored, and a mock will never tell you
// that.
//
// Every isolation claim is probed from INSIDE the container rather than by
// reading the Pod object back, because the Pod object only echoes the request.
// If the container reports uid 10001 and cannot write to /, the kubelet applied
// it.
//
// Expects KUBECONFIG to point at a cluster with k8s/base/{namespace,rbac}.yaml
// applied. In CI that is a kind cluster and a kubeconfig minted for the
// scorpion-backend ServiceAccount, so the Role is exercised for real rather
// than assumed.
//
// Run:
//   npm run build && node dist/backend/src/scripts/smoke_k8s_job_runner.js
import { KubernetesJobRunner } from '../services/runner/kubernetesJobRunner';
import { RUNNER_NAMESPACE } from '../services/runner/jobSpec';

let failures = 0;
const check = (ok: boolean, msg: string): void => {
  if (ok) console.log(`  [PASS] ${msg}`);
  else { failures += 1; console.error(`  [FAIL] ${msg}`); }
};

const collector = () => {
  const lines: string[] = [];
  return { log: (m: string) => lines.push(m), text: () => lines.join('\n') };
};

const IMAGE = 'alpine:3.20';

async function main(): Promise<void> {
  console.log(`Kubernetes Job runner smoke test — namespace ${RUNNER_NAMESPACE}\n`);
  const runner = new KubernetesJobRunner();

  // One Job reports on its own confinement. Probing from inside avoids racing
  // the cleanup that deletes the Pod, and is stronger evidence than reading
  // back the spec we submitted.
  console.log('Enforced isolation (probed from inside the container):');
  const probe = await runner.run({
    name: 'isolation-probe',
    image: IMAGE,
    command: ['/bin/sh', '-c'],
    args: [[
      'echo "UID=$(id -u)"',
      // readOnlyRootFilesystem
      'touch /probe 2>&1 | head -1',
      // /tmp is the emptyDir, so it must still be writable
      'touch /tmp/probe && echo "TMP=writable" || echo "TMP=readonly"',
      // automountServiceAccountToken: false
      '[ -d /var/run/secrets/kubernetes.io/serviceaccount ] && echo "TOKEN=present" || echo "TOKEN=absent"',
      // CapDrop ALL: binding a low port needs CAP_NET_BIND_SERVICE
      'nc -l -p 80 -w 1 2>&1 | head -1 || true',
      'echo "PROBE=done"',
    ].join('; ')],
    timeoutSeconds: 120,
  }, collector());

  const out = probe.logs;
  console.log(out.split('\n').map((l) => `    | ${l}`).join('\n'));

  check(probe.exitCode === 0, `the Job ran to completion (exit ${probe.exitCode})`);
  check(/UID=10001/.test(out), 'the kubelet applied runAsUser 10001');
  check(/Read-only file system/i.test(out), 'the root filesystem is read-only in practice');
  check(/TMP=writable/.test(out), 'the bounded emptyDir is still writable, so the workload can run');
  check(/TOKEN=absent/.test(out), 'no ServiceAccount token is mounted — the workload cannot reach the API');
  check(/permission denied|Operation not permitted/i.test(out), 'capabilities are dropped: binding port 80 is refused');

  // Lifecycle: dispatch, poll to completion, collect stdout, clean up.
  console.log('\nLifecycle:');
  const marker = `hello-${Date.now()}`;
  const lifecycle = await runner.run({
    name: 'lifecycle',
    image: IMAGE,
    command: ['/bin/sh', '-c'],
    args: [`echo ${marker}`],
    timeoutSeconds: 120,
  }, collector());

  check(lifecycle.exitCode === 0, `success is reported as exit 0 (got ${lifecycle.exitCode})`);
  check(lifecycle.logs.includes(marker), 'stdout was collected from the pod');
  check(!lifecycle.timedOut, 'a fast Job is not reported as timed out');

  // activeDeadlineSeconds, enforced by the cluster rather than by our poll loop.
  console.log('\nDeadline:');
  const hang = await runner.run({
    name: 'deadline',
    image: IMAGE,
    command: ['/bin/sh', '-c'],
    args: ['sleep 300'],
    timeoutSeconds: 10,
  }, collector());

  check(hang.exitCode !== 0, 'a Job past its deadline does not report success');
  check(hang.timedOut, 'DeadlineExceeded is surfaced as a timeout, distinct from an ordinary failure');

  // A failing workload is a result, not an exception.
  console.log('\nFailure:');
  const failed = await runner.run({
    name: 'failing',
    image: IMAGE,
    command: ['/bin/sh', '-c'],
    args: ['exit 3'],
    timeoutSeconds: 120,
  }, collector());

  check(failed.exitCode !== 0, 'a failing workload reports non-zero rather than throwing');
  check(!failed.timedOut, 'an ordinary failure is not mislabelled as a timeout');

  console.log('');
  if (failures > 0) { console.error(`FAILED — ${failures} check(s).`); process.exit(1); }
  console.log('PASSED — the cluster enforced the isolation, and the lifecycle holds.');
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
