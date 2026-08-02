import { randomBytes, randomUUID } from 'crypto';

/**
 * Proof that a scanner actually looked at the workspace.
 *
 * Zero egress stops a compromised scanner from exfiltrating. It does not stop
 * it lying — a scanner that suppresses every finding and prints `[]` is
 * indistinguishable from a clean repository, and no signature or attestation
 * fixes that, because the thing signing is the thing lying.
 *
 * Nor does hashing the workspace: the scanner holds the files, so computing
 * their digest proves delivery, not analysis.
 *
 * A canary makes the CONTENT of the report load-bearing. A known-detectable
 * secret is planted in the tree, and a report that comes back without it is
 * rejected. To defeat this an attacker must tell canary findings apart from
 * real ones and preserve exactly the former — and since both the directory
 * token and the key material are random per run, there is nothing stable to
 * match on.
 *
 * Honest limit: this proves the scanner is STILL DETECTING, not that it
 * detected everything. Only running independent scanners over the same tree and
 * comparing would show that, and it costs more than it is worth here.
 */

export interface CanaryFile {
  /** Path inside the archive, relative to the workspace root. */
  name: string;
  content: string;
}

export interface Canary {
  /**
   * Random token appearing in the injected path. Both the scrub and the
   * detection check key on it, so it must not collide with repository content —
   * a UUID cannot.
   */
  marker: string;
  files: CanaryFile[];
}

/**
 * Tools whose reports are required to contain the canary.
 *
 * gitleaks only, deliberately. Its detection is pure offline regex, so it
 * behaves identically under the runner's zero-egress NetworkPolicy, and secrets
 * are the one payload that is trivially detectable without shipping a
 * vulnerable dependency tree.
 *
 * The others are NOT covered and must not be added without a payload each can
 * actually detect: semgrep needs a rule match, trivy a vulnerable manifest (and
 * only reports secrets when `--scanners secret` is in play), checkov a
 * misconfiguration. Requiring a canary a tool cannot detect would fail every
 * scan.
 */
export const CANARY_TOOLS: ReadonlySet<string> = new Set(['gitleaks']);

export function requiresCanary(tool: string): boolean {
  return CANARY_TOOLS.has(tool);
}

/** Uppercase alphanumerics, the character set of an AWS access key id. */
function keyId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = randomBytes(16);
  return `AKIA${Array.from(bytes, b => alphabet[b % alphabet.length]).join('')}`;
}

/**
 * A fresh canary.
 *
 * The key material is generated rather than taken from AWS's documented example
 * value, for two reasons: a well-known example may sit in a scanner's allowlist,
 * which would make the canary silently never fire and fail every scan closed;
 * and a predictable payload is one an attacker can special-case.
 */
export function createCanary(): Canary {
  const marker = randomUUID().replace(/-/g, '');
  const dir = `.scorpion-canary-${marker}`;

  return {
    marker,
    files: [{
      name: `${dir}/credentials`,
      content: [
        '[default]',
        `aws_access_key_id = ${keyId()}`,
        `aws_secret_access_key = ${randomBytes(30).toString('base64').slice(0, 40)}`,
        '',
      ].join('\n'),
    }],
  };
}

export interface ScrubResult {
  /** The report with every canary-bearing entry removed. */
  cleaned: unknown;
  /** How many entries were removed. Zero means the scanner never saw the payload. */
  hits: number;
  /**
   * True when the marker survived the scrub — it appeared somewhere that is not
   * an array element, so there was no entry to drop. The caller must refuse the
   * report rather than forward it: a synthetic credential reaching a customer's
   * dashboard is its own incident.
   */
  leaked: boolean;
}

/**
 * Removes canary findings from a parsed scanner report.
 *
 * Structural rather than textual, and tool-agnostic: findings are array
 * elements in every scanner's JSON — gitleaks emits a top-level array, trivy
 * nests them under Results[].Secrets[], semgrep under results[] — so dropping
 * array elements whose subtree mentions the marker works for all of them
 * without teaching this function any one schema.
 *
 * Keyed on the injected PATH, not on the key material. A scanner is free to
 * truncate or mask the matched secret in its output (`AKIA...MPLE`), which
 * would defeat matching on the value; the file path it reports is untouched.
 */
export function scrubCanary(report: unknown, marker: string): ScrubResult {
  let hits = 0;

  const mentions = (node: unknown): boolean => {
    try {
      return JSON.stringify(node)?.includes(marker) ?? false;
    } catch {
      // Circular structures cannot come from JSON.parse, but a caller could
      // pass anything. Treat unserialisable as "cannot prove it is clean".
      return true;
    }
  };

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      const kept: unknown[] = [];
      for (const item of node) {
        if (mentions(item)) { hits += 1; continue; }
        kept.push(walk(item));
      }
      return kept;
    }
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    }
    return node;
  };

  const cleaned = walk(report);
  return { cleaned, hits, leaked: mentions(cleaned) };
}
