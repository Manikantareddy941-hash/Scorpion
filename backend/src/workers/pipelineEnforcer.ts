// src/workers/pipelineEnforcer.ts
/**
 * CI/CD release-gate enforcer. Run as a standalone step in a pipeline:
 *   ts-node src/workers/pipelineEnforcer.ts   (or compiled: node dist/workers/pipelineEnforcer.js)
 *
 * Calls the server-side release gate (POST /api/gates/evaluate), which is the
 * single source of truth for gate rules + scan-result evaluation. Exits 1 when
 * the gate is BLOCKED so the pipeline stops the release. Fails CLOSED: any
 * network/auth/parse error also exits 1 — a security gate must never wave a
 * deploy through because the check itself broke.
 *
 * Required env:
 *   SCORPION_API_URL   Base URL of the backend (e.g. https://api.scorpion.example)
 *   SCORPION_API_TOKEN Bearer JWT for an account with access to the repo
 *   REPO_ID            Target repository id to evaluate
 */

export {}; // module scope — keeps top-level helpers out of the global script namespace

interface GateEvaluateResponse {
  repo_id: string;
  score: number;
  status: 'passing' | 'BLOCKED';
  blocker_count: number;
  blockers: Array<{ id: string; title: string; severity: string; package: string }>;
}

const REQUEST_TIMEOUT_MS = Number(process.env.PIPELINE_ENFORCER_TIMEOUT_MS) || 30_000;

function fail(message: string): never {
  process.stderr.write(`[PipelineEnforcer] ${message}\n`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) fail(`Missing required environment variable "${name}"`);
  return value;
}

async function main(): Promise<void> {
  const baseUrl = requireEnv('SCORPION_API_URL').replace(/\/+$/, '');
  const token = requireEnv('SCORPION_API_TOKEN');
  const repoId = requireEnv('REPO_ID');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/gates/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ repo_id: repoId }),
      signal: controller.signal,
    });
  } catch (err) {
    return fail(`Gate request failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    fail(`Gate endpoint returned HTTP ${res.status}. ${detail}`.trim());
  }

  let result: GateEvaluateResponse;
  try {
    result = (await res.json()) as GateEvaluateResponse;
  } catch (err) {
    return fail(`Could not parse gate response: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (result.status === 'BLOCKED') {
    process.stderr.write(
      `[PipelineEnforcer] RELEASE BLOCKED for ${result.repo_id} — ` +
        `score ${result.score}, ${result.blocker_count} blocker(s):\n`,
    );
    for (const b of result.blockers) {
      process.stderr.write(`  - [${b.severity.toUpperCase()}] ${b.package}: ${b.title}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(
    `[PipelineEnforcer] Gate PASSED for ${result.repo_id} (score ${result.score}, ${result.blocker_count} blocker(s)).\n`,
  );
  process.exit(0);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
