import Docker from 'dockerode';

/**
 * Builds the Docker HostConfig for a workload container.
 *
 * Extracted from DockerRunnerService so the isolation posture is testable
 * without a Docker daemon. These flags are the only thing standing between a
 * malicious `package.json` build script and the worker node: the backend runs
 * containerised with /var/run/docker.sock bind-mounted, and socket access is
 * root-equivalent on the host.
 */

export interface IsolationOptions {
  /**
   * Outbound network. Default DENY.
   *
   * The scanners do not need it — their rules and databases belong in the image
   * or a warmed cache. Only dependency resolution genuinely does, so egress is
   * requested explicitly by the one stage that needs it and the exfiltration
   * path is confined to that stage rather than open during analysis.
   */
  allowEgress?: boolean;
  /** Read-only binds beyond the workspace, e.g. a warmed scanner DB cache. */
  extraBinds?: string[];
  /**
   * Override the unprivileged user. `null` runs as the image default, which is
   * usually root — only for images that genuinely cannot run otherwise.
   */
  user?: string | null;
  /**
   * Read-only root filesystem. Opt-in: it is the flag most likely to break an
   * image that writes outside the workspace (npm caches, scanner temp files),
   * so it is enabled per caller once verified rather than globally.
   */
  readonlyRootfs?: boolean;
}

const num = (name: string, fallback: number): number => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

/** Wall-clock ceiling. Without one a hanging container wedges the worker forever. */
export const timeoutMs = (): number => num('RUNNER_TIMEOUT_MS', 15 * 60_000);

/** Unprivileged by default; an operator can revert without a code change. */
export const defaultUser = (): string => process.env.RUNNER_USER || '1000:1000';

export function buildHostConfig(
  absoluteWorkspace: string,
  options: IsolationOptions = {},
): Docker.HostConfig {
  const memoryBytes = num('RUNNER_MEMORY_MB', 2048) * 1024 * 1024;

  return {
    Binds: [`${absoluteWorkspace}:/workspace`, ...(options.extraBinds ?? [])],
    // Removed explicitly in a finally block so a killed container is still
    // cleaned up and its exit status stays readable until then.
    AutoRemove: false,

    // B1: no egress unless the caller asked for it.
    NetworkMode: options.allowEgress ? 'bridge' : 'none',

    // B2: strip capabilities and block setuid escalation. Even as root inside
    // the container, the process cannot acquire new privileges.
    CapDrop: ['ALL'],
    SecurityOpt: ['no-new-privileges'],

    // B4: a zip bomb, fork bomb or spin loop is contained to its own limits
    // rather than taking the host down with it. MemorySwap equals Memory so the
    // limit cannot be sidestepped by swapping.
    Memory: memoryBytes,
    MemorySwap: memoryBytes,
    PidsLimit: num('RUNNER_PIDS_LIMIT', 512),
    NanoCpus: num('RUNNER_CPUS', 2) * 1_000_000_000,

    ...(options.readonlyRootfs
      // noexec on the writable tmp: a read-only root is worth little if the
      // scratch space it forces everything into can host a dropped binary.
      ? { ReadonlyRootfs: true, Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=256m' } }
      : {}),
  };
}
