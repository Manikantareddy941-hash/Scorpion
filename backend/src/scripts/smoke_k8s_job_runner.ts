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
import fs from 'fs';
import os from 'os';
import path from 'path';
import { KubernetesJobRunner } from '../services/runner/kubernetesJobRunner';
import { BEGIN_MARKER, emitReportCommand, parseFramedReport } from '../services/runner/reportFraming';
import { buildScript } from '../services/runner/kubernetesRunner';
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


  // The zero-egress NetworkPolicy. Only meaningful because CI runs an enforcing
  // CNI — kindnet accepts the object and enforces nothing, which would make
  // this check pass while proving the opposite.
  console.log('\nZero egress:');
  const net = await runner.run({
    name: 'egress-probe',
    image: IMAGE,
    command: ['/bin/sh', '-c'],
    args: ['(nc -z -w 3 1.1.1.1 443 && echo NET=reachable) || echo NET=blocked; (getent hosts example.com >/dev/null && echo DNS=resolved) || echo DNS=blocked'],
    timeoutSeconds: 60,
  }, collector());
  console.log(net.logs.split('\n').map((l) => `    | ${l}`).join('\n'));
  check(/NET=blocked/.test(net.logs), 'outbound TCP is refused');
  check(/DNS=blocked/.test(net.logs), 'DNS does not resolve — there is no hole to tunnel through');

  // The push transport, end to end: a real tarball over the exec channel into a
  // pod that was waiting on the sentinel.
  console.log('\nWorkspace transport:');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-ws-'));
  fs.writeFileSync(path.join(workspace, 'marker.txt'), 'delivered-by-exec');
  fs.mkdirSync(path.join(workspace, 'nested'));
  fs.writeFileSync(path.join(workspace, 'nested', 'report.json'), '{"findings":[]}');

  const transportLog = collector();
  const transported = await runner.run({
    name: 'transport',
    image: IMAGE,
    withWorkspace: true,
    workspacePath: workspace,
    command: ['/bin/sh', '-c'],
    args: [`cat /workspace/marker.txt; ${emitReportCommand('/workspace/nested/report.json')}`],
    timeoutSeconds: 180,
  }, transportLog);
  fs.rmSync(workspace, { recursive: true, force: true });

  // The dispatcher's own narration. Without it a transport failure reports only
  // that it failed, which is what the first CI run of this check did.
  const indent = (text: string, prefix: string) =>
    text.split('\n').map((l) => `    ${prefix} ${l}`).join('\n');
  console.log(indent(transportLog.text(), '>'));
  if (transported.logs) console.log(indent(transported.logs, '|'));

  check(!transported.transportFailed, 'the workspace was streamed in over exec');
  check(transported.exitCode === 0, `the workload ran against it (exit ${transported.exitCode})`);
  check(transported.logs.includes('delivered-by-exec'), 'file contents survived the tar round trip');

  const framed = parseFramedReport(transported.logs);
  check(framed.ok, `the framed report verified its own length and digest${framed.ok ? '' : ` (${framed.reason})`}`);
  if (framed.ok) check(framed.body === '{"findings":[]}', 'the report came back byte-identical');

  // The RunnerProvider script contract, run for real. The adapter's unit tests
  // use a stub dispatcher, which cannot show whether the generated shell
  // actually redirects, preserves the exit code, and emits a parseable frame
  // inside a container with a read-only root filesystem.
  console.log('\nRunnerProvider script contract:');
  const scripted = async (tool: string, args: string[]) => runner.run({
    name: 'script', image: IMAGE, command: ['/bin/sh', '-c'],
    args: [buildScript(tool, args)], timeoutSeconds: 120,
  }, collector());

  const clean = await scripted('echo', ['{"Results":[]}']);
  const cleanReport = parseFramedReport(clean.logs);
  check(cleanReport.ok, 'the generated script emits a parseable frame');
  if (cleanReport.ok) check(cleanReport.body === '{"Results":[]}', 'tool stdout is captured and returned verbatim');
  check(clean.exitCode === 0, 'a successful tool reports exit 0');

  // Without capturing rc before the emission, every scanner would report
  // success no matter how it died — the emission itself always succeeds.
  const failing = await scripted('false', []);
  check(failing.exitCode !== 0, `a failing tool keeps its non-zero exit through the emission (got ${failing.exitCode})`);

  // Quoting is a boundary here: the arguments are assembled into a shell string
  // so stdout can be redirected.
  const awkward = await scripted('echo', [`it's "quoted" $HOME`]);
  const awkwardReport = parseFramedReport(awkward.logs);
  check(awkwardReport.ok && awkwardReport.body === `it's "quoted" $HOME`,
    'quotes and shell metacharacters in an argument survive unexpanded');

  // stderr must stay outside the frame, or it lands in stdout and makes a
  // crashed scanner look like one that reported.
  const noisy = await scripted('sh', ['-c', 'echo oops >&2; echo {}']);
  const noisyReport = parseFramedReport(noisy.logs);
  check(noisyReport.ok && noisyReport.body === '{}', 'stderr does not contaminate the captured report');
  check(noisy.logs.indexOf('oops') < noisy.logs.indexOf(BEGIN_MARKER), 'stderr stays outside the frame, where the adapter reads it');

  console.log('');
  if (failures > 0) { console.error(`FAILED — ${failures} check(s).`); process.exit(1); }
  console.log('PASSED — the cluster enforced the isolation, and the lifecycle holds.');
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
