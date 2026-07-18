/**
 * Tool execution abstraction. Scorpion's scanners have historically been run
 * three different ways (spawn-docker in the orchestrator, dockerode in
 * dockerRunnerService, bare spawn elsewhere). This is the single seam they
 * collapse onto, so the execution strategy becomes a deployment choice rather
 * than something hardcoded per call site.
 */

export type RunnerMode = 'docker' | 'binary';

export interface ToolRun {
  /** Logical tool name, e.g. 'trivy'. Maps to an image or a binary per mode. */
  tool: string;
  /** Tool arguments using host paths; the docker runner rewrites them to the mount. */
  args: string[];
  /** Host directory the tool reads. */
  workspacePath: string;
  timeoutMs: number;
}

export interface ToolResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface RunnerProvider {
  readonly mode: RunnerMode;
  /** False when this mode cannot run the tool at all — callers must report
   *  `unavailable`, never a clean/empty result. */
  supports(tool: string): boolean;
  run(run: ToolRun): Promise<ToolResult>;
}

/** Container image per tool, used by the docker runner. */
export const TOOL_IMAGES: Record<string, string> = {
  semgrep: 'semgrep/semgrep:latest',
  gitleaks: 'zricethezav/gitleaks:latest',
  trivy: 'aquasec/trivy:latest',
  checkov: 'bridgecrew/checkov:latest',
  bandit: 'bandit:latest',
  hadolint: 'hadolint/hadolint:latest',
};

/**
 * Tools that cannot run as a plain host process.
 *
 * ZAP needs a JVM plus a browser stack, and Falco needs kernel-level eBPF — it
 * is a cluster agent, not something a web process can spawn. Both stay
 * docker-only (decision D3). Everything else in TOOL_IMAGES ships as a static
 * binary or a pip package and runs fine without a daemon.
 */
export const BINARY_UNSUPPORTED = new Set(['zap', 'falco']);
