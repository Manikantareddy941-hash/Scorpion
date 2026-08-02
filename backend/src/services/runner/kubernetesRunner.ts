import { logger } from '../logger';
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
  return `${invocation} >${REPORT_PATH}; rc=$?; ${emitReportCommand(REPORT_PATH)}; exit $rc`;
}

/** Just the method the adapter needs, so a test can supply a stub. */
export interface JobDispatcher {
  run(
    request: { name: string; image: string; command?: string[]; args?: string[]; timeoutSeconds?: number; withWorkspace?: boolean; workspacePath?: string },
    log: { log: (m: string) => void },
  ): Promise<{ exitCode: number; logs: string; timedOut: boolean; transportFailed?: boolean }>;
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

    const outcome = await this.dispatcher.run({
      name: sanitizeName(tool),
      image,
      command: ['/bin/sh', '-c'],
      args: [buildScript(tool, rewriteArgs(args, workspacePath))],
      timeoutSeconds: Math.ceil(timeoutMs / 1000),
      withWorkspace: true,
      workspacePath,
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

    return { stdout: framed.body, stderr, exitCode: outcome.exitCode };
  }
}
