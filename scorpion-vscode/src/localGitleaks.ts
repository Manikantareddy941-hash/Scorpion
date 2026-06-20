import { spawnSync } from 'child_process';
import { Finding } from './scorpionClient';

let cachedAvailable: boolean | undefined;

/** Test-only: clears the availability cache so each test starts fresh. */
export function __resetAvailabilityCacheForTests(): void {
  cachedAvailable = undefined;
}

/** Checks once per extension session whether gitleaks is on PATH. */
export function isGitleaksAvailable(): boolean {
  if (cachedAvailable !== undefined) {
    return cachedAvailable;
  }
  try {
    const result = spawnSync('gitleaks', ['version'], { timeout: 5000 });
    cachedAvailable = result.status === 0;
  } catch {
    cachedAvailable = false;
  }
  return cachedAvailable;
}

interface GitleaksMatch {
  RuleID: string;
  Description: string;
  StartLine: number;
  Match: string;
}

/**
 * Fast, local, no-Docker secret scan of a single file. Intended for on-save
 * IDE feedback - this is NOT the full Semgrep/Trivy/Gitleaks pipeline (that
 * runs in Docker via the backend and is far too slow to run on every save).
 */
export function scanFileForSecrets(filePath: string): Finding[] {
  if (!isGitleaksAvailable()) {
    return [];
  }

  try {
    const result = spawnSync(
      'gitleaks',
      ['detect', '--source', filePath, '--no-git', '-f', 'json', '-r', '-', '--exit-code', '0'],
      { timeout: 10000, encoding: 'utf8' }
    );

    if (!result.stdout || !result.stdout.trim()) {
      return [];
    }

    const matches: GitleaksMatch[] = JSON.parse(result.stdout);
    return matches.map((m, i) => ({
      id: `local-secret-${i}-${m.RuleID}`,
      type: 'secret' as const,
      severity: 'CRITICAL' as const,
      title: `Potential secret: ${m.RuleID}`,
      file: filePath,
      line: m.StartLine,
      message: m.Description,
    }));
  } catch {
    // Fail open - a local lint-style check should never block the editor.
    return [];
  }
}
