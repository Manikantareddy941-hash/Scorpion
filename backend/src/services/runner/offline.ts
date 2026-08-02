/**
 * What each scanner needs in order to work with no network at all.
 *
 * The runner namespace denies egress, so a tool invoked the way it is invoked
 * on a developer's laptop will either fail or — worse — quietly produce a
 * partial answer. `semgrep --config auto` resolves its ruleset over the network
 * by definition; trivy downloads its vulnerability database on first use.
 *
 * This lives with the runner rather than in orchestrateScan because it is the
 * runner that knows its own network posture. The orchestrator builds the same
 * arguments regardless of where the scan executes, and the docker and binary
 * runners have egress and must NOT get these flags — the baked paths do not
 * exist there.
 */

/** Where the trivy database is staged inside its image. See docker/scanners/trivy.Dockerfile. */
export const TRIVY_DB_SOURCE = '/opt/trivy-db';
/** Writable volume the database is copied into before a scan. */
export const TRIVY_CACHE_PATH = '/cache';
/** Where semgrep's vendored ruleset lives. */
export const SEMGREP_RULES_PATH = '/rules';

export interface ScratchVolume {
  mountPath: string;
  sizeLimit: string;
}

export interface OfflineProfile {
  /** Shell run before the tool, in the same invocation. Empty when nothing is needed. */
  prelude?: string;
  /** Rewrites the orchestrator's arguments for offline operation. */
  rewrite(args: string[]): string[];
  /** An extra writable volume the pod must mount for this tool. */
  scratch?: ScratchVolume;
}

const IDENTITY: OfflineProfile = { rewrite: args => args };

const PROFILES: Record<string, OfflineProfile> = {
  trivy: {
    // Trivy opens its BoltDB read-write even with --skip-db-update, so the
    // database cannot be read from the image layer under a read-only root
    // filesystem — it fails with `permission denied` whatever the file mode
    // says, because the mount is immutable. Staging it into a writable volume
    // is the cost of keeping readOnlyRootFilesystem.
    prelude: `cp -a ${TRIVY_DB_SOURCE}/. ${TRIVY_CACHE_PATH}/`,
    rewrite: args => [
      ...args,
      '--cache-dir', TRIVY_CACHE_PATH,
      // Without these it attempts a download that the NetworkPolicy blocks.
      // --skip-java-db-update matters because the java database is deliberately
      // not baked: its absence degrades jar coverage instead of failing a scan.
      '--skip-db-update',
      '--skip-java-db-update',
    ],
    // The database is ~1.2 GiB and this is a straight copy of it. Sized with
    // headroom because a copy that runs out of space produces a partial
    // database, and a partial database reports findings it simply cannot see.
    scratch: { mountPath: TRIVY_CACHE_PATH, sizeLimit: '3Gi' },
  },

  semgrep: {
    // `auto` is a network call: it resolves the ruleset from semgrep.dev and
    // reports metrics there. Replaced rather than supplemented — appending a
    // second --config would leave the fetch in place.
    rewrite: args => {
      const out = [...args];
      const configAt = out.indexOf('--config');
      if (configAt !== -1 && configAt + 1 < out.length) out[configAt + 1] = SEMGREP_RULES_PATH;
      else out.push('--config', SEMGREP_RULES_PATH);
      if (!out.includes('--metrics=off')) out.push('--metrics=off');
      return out;
    },
  },
};

export function offlineProfile(tool: string): OfflineProfile {
  return PROFILES[tool] ?? IDENTITY;
}

/**
 * Tools we bake and therefore verify.
 *
 * Only the two that need network at scan time. gitleaks, bandit and hadolint
 * compile their rules in, and checkov ships its policies — they have no
 * database to go stale, so there is nothing for a freshness gate to check and
 * no reason to rebuild them daily.
 *
 * Those four still run from upstream images on mutable tags, which is the
 * `:latest` pinning debt accepted for Phase 4. Stated here rather than left
 * implicit: they are dispatched unverified.
 */
const BAKED_TOOLS = new Set(['trivy', 'semgrep']);

export function isBaked(tool: string): boolean {
  return BAKED_TOOLS.has(tool);
}

/**
 * The registry path for a baked image, e.g. ghcr.io/acme/scorpion-trivy.
 *
 * Throws rather than falling back to the upstream image when the repository is
 * unconfigured. An upstream trivy cannot work under the egress policy anyway,
 * and it would fail somewhere deep in the scanner with an error nobody can
 * trace back to a missing environment variable.
 */
export function bakedImageRef(tool: string): string {
  const repo = process.env.SCANNER_IMAGE_REPO;
  if (!repo) {
    throw new Error(
      `SCANNER_IMAGE_REPO is not configured — ${tool} has no baked image to run, and the upstream one cannot reach its database under the runner's egress policy`,
    );
  }
  return `${repo.replace(/\/+$/, '')}/scorpion-${tool}`;
}
