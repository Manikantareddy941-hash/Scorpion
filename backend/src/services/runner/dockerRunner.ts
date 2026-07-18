import { spawn } from 'child_process';
import { TOOL_IMAGES, type RunnerProvider, type ToolResult, type ToolRun } from './types';

/**
 * Runs a tool in an ephemeral container via the `docker` CLI. This is the
 * behaviour Scorpion has always had, extracted from scan/orchestrator.ts
 * unchanged so the extraction itself carries no behavioural risk.
 *
 * Requires a Docker daemon, so it is unavailable on free-tier hosting — see
 * binaryRunner for that case.
 */

/** The workspace is mounted here; host paths in args are rewritten to match. */
const CONTAINER_PATH = '/src';

/** Args carry host paths (absolute POSIX or Windows drive-letter). The tool
 *  sees the mount instead, so any arg equal to the mounted dir is rewritten. */
function rewriteArgs(args: string[], workspacePath: string): string[] {
  return args.map(arg => (arg === workspacePath ? CONTAINER_PATH : arg));
}

export class DockerRunner implements RunnerProvider {
  readonly mode = 'docker' as const;

  supports(_tool: string): boolean {
    return true; // a daemon can run any of the tool images
  }

  async run({ tool, args, workspacePath, timeoutMs }: ToolRun): Promise<ToolResult> {
    const image = TOOL_IMAGES[tool] ?? tool;
    const dockerArgs = [
      'run', '--rm',
      '-v', `${workspacePath}:${CONTAINER_PATH}`,
      '-w', CONTAINER_PATH,
      image,
      ...rewriteArgs(args, workspacePath),
    ];

    return new Promise<ToolResult>((resolve, reject) => {
      const child = spawn('docker', dockerArgs, { timeout: timeoutMs });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', d => { stdout += d.toString(); });
      child.stderr?.on('data', d => { stderr += d.toString(); });
      // Reject rather than resolve-empty: a scanner that never started must not
      // be reported as a clean scan. The caller decides how to surface it.
      child.on('error', err => reject(err));
      child.on('close', exitCode => resolve({ stdout, stderr, exitCode }));
    });
  }
}
