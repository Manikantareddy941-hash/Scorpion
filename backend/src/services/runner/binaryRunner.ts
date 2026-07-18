import { spawn } from 'child_process';
import path from 'path';
import { BINARY_UNSUPPORTED, type RunnerProvider, type ToolResult, type ToolRun } from './types';

/**
 * Runs a tool as a plain host process. No daemon, no socket, no bind mount —
 * which is what makes Scorpion deployable on free-tier hosting where Docker is
 * unavailable.
 *
 * Simpler than the docker path rather than harder: the tool reads host paths
 * directly, so there is no mount to set up and no argument rewriting.
 */

/** Directory holding pinned scanner binaries. Unset → resolve from PATH. */
function resolveBinary(tool: string): string {
  const binDir = process.env.SCORPION_BIN_DIR;
  return binDir ? path.join(binDir, tool) : tool;
}

export class BinaryRunner implements RunnerProvider {
  readonly mode = 'binary' as const;

  supports(tool: string): boolean {
    return !BINARY_UNSUPPORTED.has(tool);
  }

  async run({ tool, args, workspacePath, timeoutMs }: ToolRun): Promise<ToolResult> {
    if (!this.supports(tool)) {
      throw new Error(`Tool '${tool}' cannot run in binary mode (requires a container runtime)`);
    }

    return new Promise<ToolResult>((resolve, reject) => {
      const child = spawn(resolveBinary(tool), args, { cwd: workspacePath, timeout: timeoutMs });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', d => { stdout += d.toString(); });
      child.stderr?.on('data', d => { stderr += d.toString(); });
      // A missing binary surfaces here as ENOENT. Reject rather than
      // resolve-empty so it can never be mistaken for a clean scan.
      child.on('error', err => reject(err));
      child.on('close', exitCode => resolve({ stdout, stderr, exitCode }));
    });
  }
}
