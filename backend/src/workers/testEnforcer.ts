// src/workers/testEnforcer.ts
/**
 * Standalone smoke test for the pipeline release-gate enforcer.
 *
 * Run directly (NOT via jest — the filename does not match this repo's
 * `*.test.ts` testMatch on purpose, so `npm test` won't pick it up):
 *   npx ts-node src/workers/testEnforcer.ts
 *
 * Mocks the POST /api/gates/evaluate response as BLOCKED and asserts that
 * `main()` exits the process with code 1. Exits 0 itself on pass, 1 on failure.
 */

import assert from 'node:assert';
import { main } from './pipelineEnforcer';

// Sentinel thrown by our process.exit stub so we can intercept the exit
// instead of actually terminating the test runner.
class ProcessExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
  }
}

const BLOCKED_RESPONSE = {
  repo_id: 'repo-under-test',
  status: 'BLOCKED' as const,
  score: 50,
  blocker_count: 1,
  blockers: [
    { id: 'CVE-2024-0001', title: 'Critical RCE', severity: 'critical', package: 'evil-dep' },
  ],
};

async function run(): Promise<void> {
  // Required env so requireEnv() passes and main() reaches the fetch call.
  process.env.SCORPION_API_URL = 'https://api.test.local';
  process.env.SCORPION_API_TOKEN = 'test-token';
  process.env.REPO_ID = 'repo-under-test';

  const realFetch = global.fetch;
  const realExit = process.exit;

  let capturedUrl = '';
  let capturedBody = '';

  // Mock the API: return a BLOCKED gate evaluation.
  global.fetch = (async (url: string, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedBody = String(init?.body ?? '');
    return {
      ok: true,
      status: 200,
      json: async () => BLOCKED_RESPONSE,
      text: async () => JSON.stringify(BLOCKED_RESPONSE),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  // Capture the exit code instead of killing the process.
  process.exit = ((code?: number) => {
    throw new ProcessExitError(code ?? 0);
  }) as (code?: number) => never;

  let exitCode: number | undefined;
  try {
    await main();
    // main() must not return — it always exits.
    assert.fail('main() returned without calling process.exit');
  } catch (err) {
    if (err instanceof ProcessExitError) {
      exitCode = err.code;
    } else {
      throw err;
    }
  } finally {
    global.fetch = realFetch;
    process.exit = realExit;
  }

  // Assertions.
  assert.strictEqual(exitCode, 1, `expected exit code 1 for BLOCKED gate, got ${exitCode}`);
  assert.match(capturedUrl, /\/api\/gates\/evaluate$/, 'should POST to the gate evaluate endpoint');
  assert.deepStrictEqual(
    JSON.parse(capturedBody),
    { repo_id: 'repo-under-test' },
    'should send the target repo_id in the request body',
  );

  process.stdout.write('PASS: BLOCKED gate triggers process.exit(1)\n');
}

run().catch((err) => {
  process.stderr.write(`FAIL: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
