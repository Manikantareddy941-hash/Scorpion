import { logger } from '../logger';
import { createCanary, requiresCanary, scrubCanary } from './canary';
import { KubernetesJobRunner } from './kubernetesJobRunner';
import { sanitizeName, WORKSPACE_PATH } from './jobSpec';
import { BEGIN_MARKER, emitReportCommand, parseFramedReport } from './reportFraming';
import { TOOL_IMAGES, type RunnerProvider, type ToolResult, type ToolRun } from './types';

/**
 * Runs a tool as a Kubernetes Job, behind the same RunnerProvider seam as the
 * Docker and binary runners.
 *
 * The isolation, the zero-egress NetworkPolicy and the push transport all live
 * in KubernetesJobRunner. This is only the translation between that and the
 * ToolRun/ToolResult contract the scan orchestrator speaks — which turns out to
 * be the delicate part, for one reason:
 *
 * `pods/log` returns stdout and stderr already merged, and ToolResult needs
 * them apart. The orchestrator decides a scanner produced no verdict with
 * `exitCode !== 0 && !stdout`, so handing back a combined stream would put
 * crash output into stdout, make a dead scanner look like it reported, and
 * reopen the exact fail-open that guard exists to close.
 *
 * The report frame is the separator: the workload's stdout is captured to a
 * file and re-emitted inside markers with its own length and digest, so
 * everything outside the frame is stderr by definition.
 */

/** Tool stdout is captured here, then re-emitted framed. /tmp is the writable emptyDir. */
const REPORT_PATH = '/tmp/report.json';

/**
 * Tool stderr is captured here rather than left to flow to the container's own
 * stderr.
 *
 * stdout and stderr are separate pipes, merged by the kubelet with no ordering
 * guarantee between them. Left alone, a scanner's diagnostics can surface
 * BETWEEN the frame markers and corrupt the report — the digest catches it, so
 * it fails closed rather than lying, but the scan fails for no real reason.
 * Replaying stderr onto stdout keeps everything on one stream, where the shell
 * guarantees the order.
 */
const STDERR_PATH = '/tmp/stderr.log';

/**
 * Args carry host paths; the workspace is streamed to WORKSPACE_PATH inside the
 * pod. Same rewrite the Docker runner does for its bind mount.
 */
function rewriteArgs(args: string[], workspacePath: string): string[] {
  return args.map(arg => (arg === workspacePath ? WORKSPACE_PATH : arg));
}

/**
 * Wraps a value for `sh -c`.
 *
 * The tool arguments are assembled into a shell string so stdout can be
 * redirected, which makes quoting a boundary rather than a formatting detail —
 * an argument derived from a repository path must not be able to close the
 * quote and append a command.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Builds the script the workload runs.
 *
 * The tool's exit code is preserved across the report emission, because the
 * emission always succeeds and would otherwise mask a scanner that failed.
 *
 * Note this overrides the image ENTRYPOINT, so `tool` must name a binary on the
 * image's PATH — true for every entry in TOOL_IMAGES, and the reason a tool
 * cannot simply be swapped for an image that only works via its entrypoint.
 */
export function buildScript(tool: string, args: string[]): string {
  const invocation = [tool, ...args].map(shellQuote).join(' ');
  return [
    `${invocation} >${REPORT_PATH} 2>${STDERR_PATH}`,
    'rc=$?',
    // Replayed onto stdout, ahead of the frame, so the two never race.
    `cat ${STDERR_PATH}`,
    emitReportCommand(REPORT_PATH),
    'exit $rc',
  ].join('; ');
}

/** Just the method the adapter needs, so a test can supply a stub. */
export interface JobDispatcher {
  run(
    request: {
      name: string; image: string; command?: string[]; args?: string[];
      timeoutSeconds?: number; withWorkspace?: boolean; workspacePath?: string;
      extraFiles?: readonly { name: string; content: string }[];
    },
    log: { log: (m: string) => void },
  ): Promise<{ exitCode: number; logs: string; timedOut: boolean; transportFailed?: boolean }>;
}

/**
 * Verifies the canary and strips it from the report.
 *
 * Runs before the result leaves the adapter, so nothing downstream — the
 * normalizers, the policy engine, the stored findings, a PR comment — ever sees
 * the synthetic credential.
 *
 * Every failure here is a refusal rather than a passed-through report. A report
 * that cannot be parsed cannot be scrubbed either, and forwarding it would leak
 * a fake secret into a customer's dashboard.
 */
function verifyAndScrub(tool: string, body: string, marker: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`${tool}: report is not parseable JSON, so the canary could not be verified or removed`);
  }

  const { cleaned, hits, leaked } = scrubCanary(parsed, marker);

  if (hits === 0) {
    // The scanner ran and reported, but did not find a secret planted directly
    // in its path. Its detection was suppressed, broken, or bypassed, and any
    // "clean" verdict from it is unsupported.
    throw new Error(`${tool}: canary was not detected — the scanner's findings cannot be trusted`);
  }
  if (leaked) {
    throw new Error(`${tool}: canary could not be fully removed from the report — refusing to forward it`);
  }

  return JSON.stringify(cleaned);
}

export class KubernetesRunner implements RunnerProvider {
  readonly mode = 'kubernetes' as const;

  constructor(private dispatcher: JobDispatcher = new KubernetesJobRunner()) {}

  /**
   * A tool with no image cannot run here. Reported as unsupported rather than
   * attempted, so the orchestrator surfaces `unavailable` instead of a Job that
   * fails on ImagePullBackOff several minutes later.
   */
  supports(tool: string): boolean {
    return tool in TOOL_IMAGES;
  }

  async run({ tool, args, workspacePath, timeoutMs }: ToolRun): Promise<ToolResult> {
    const image = TOOL_IMAGES[tool];
    if (!image) throw new Error(`Tool '${tool}' has no container image — cannot run as a Job`);

    // Planted before the tree is streamed, and required back in the report. See
    // canary.ts — zero egress stops exfiltration, not a scanner that lies.
    const canary = requiresCanary(tool) ? createCanary() : undefined;

    const outcome = await this.dispatcher.run({
      name: sanitizeName(tool),
      image,
      command: ['/bin/sh', '-c'],
      args: [buildScript(tool, rewriteArgs(args, workspacePath))],
      timeoutSeconds: Math.ceil(timeoutMs / 1000),
      withWorkspace: true,
      workspacePath,
      extraFiles: canary?.files,
    }, { log: (m: string) => logger.info(m) });

    // Infrastructure trouble, not a scan verdict. Thrown so the orchestrator's
    // catch marks the scanner unavailable — a Job whose workspace never arrived
    // produces an empty result that is indistinguishable from a clean scan.
    if (outcome.transportFailed) {
      throw new Error(`${tool}: workspace never reached the runner — no scan was performed`);
    }

    // Killed at its deadline, so whatever it had scanned so far is a fragment of
    // an answer. A partial verdict reported as a whole one is the same lie.
    if (outcome.timedOut) {
      throw new Error(`${tool}: exceeded its ${Math.ceil(timeoutMs / 1000)}s deadline — no verdict`);
    }

    const framed = parseFramedReport(outcome.logs);
    if (!framed.ok) {
      // The frame is emitted unconditionally by buildScript, so its absence
      // means the container died before reaching it — OOM kill, image without a
      // shell, or a crash. Never a scanner that legitimately found nothing.
      throw new Error(`${tool}: no usable report (${framed.reason})`);
    }

    // Everything ahead of the frame is the tool's stderr, which is the only
    // place it can go once the two streams share a channel.
    const begin = outcome.logs.indexOf(BEGIN_MARKER);
    const stderr = begin === -1 ? '' : outcome.logs.slice(0, begin).trimEnd();

    // An empty report is left to the orchestrator, which already treats a
    // non-zero exit with no output as `unavailable`. Demanding a canary from a
    // scanner that produced nothing would report a crash as a trust failure.
    const stdout = canary && framed.body.trim()
      ? verifyAndScrub(tool, framed.body, canary.marker)
      : framed.body;

    return { stdout, stderr, exitCode: outcome.exitCode };
  }
}
