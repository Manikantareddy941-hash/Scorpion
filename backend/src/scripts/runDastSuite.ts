// src/scripts/runDastSuite.ts
/**
 * CI orchestration: runs the DAST suite (ZAP, Nuclei, ffuf) against a deployed
 * staging URL and waits for each scan to finish, so their findings are ingested
 * BEFORE the release gate is evaluated (see pipelineEnforcer.ts, run as the
 * next step). Fails CLOSED: any scan that errors, times out, or ends "failed"
 * exits 1 so the pipeline stops rather than gating on incomplete scan data.
 *
 * Required env:
 *   SCORPION_API_URL    Base URL of the backend
 *   SCORPION_API_TOKEN  Bearer JWT with access to the DAST scans
 *   DAST_TARGET_URL     Staging URL to scan
 * Optional env:
 *   DAST_SCANNERS       Comma list of zap,nuclei,ffuf (default all three)
 *   ZAP_SCAN_MODE       spider|active|passive (default active)
 *   DAST_POLL_TIMEOUT_MS Per-scan wait cap (default 20 min)
 */

export {}; // module scope

type Scanner = 'zap' | 'nuclei' | 'ffuf';

interface ScannerSpec {
    start: string;                          // POST path
    status: (scanId: string) => string;     // GET path
    body: (targetUrl: string) => Record<string, unknown>;
}

const ZAP_SCAN_MODE = process.env.ZAP_SCAN_MODE || 'active';

const SCANNERS: Record<Scanner, ScannerSpec> = {
    zap: {
        start: '/api/scan/dast/dast',
        status: (id) => `/api/scan/dast/dast/${id}/status`,
        body: (t) => ({ target_url: t, scanMode: ZAP_SCAN_MODE }),
    },
    nuclei: {
        start: '/api/scan/nuclei',
        status: (id) => `/api/scan/nuclei/${id}/status`,
        body: (t) => ({ target_url: t }),
    },
    ffuf: {
        start: '/api/scan/ffuf',
        status: (id) => `/api/scan/ffuf/${id}/status`,
        body: (t) => ({ target_url: t }),
    },
};

const POLL_INTERVAL_MS = Number(process.env.DAST_POLL_INTERVAL_MS) || 10_000;
const POLL_TIMEOUT_MS = Number(process.env.DAST_POLL_TIMEOUT_MS) || 20 * 60 * 1000;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function requireEnv(name: string): string {
    const v = process.env[name];
    if (!v) {
        process.stderr.write(`[DastSuite] Missing required environment variable "${name}"\n`);
        process.exit(1);
    }
    return v;
}

interface Deps {
    baseUrl: string;
    token: string;
    fetchFn: typeof fetch;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
}

async function postJson(deps: Deps, path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await deps.fetchFn(`${deps.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deps.token}` },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`POST ${path} returned HTTP ${res.status}. ${detail}`.trim());
    }
    return (await res.json()) as Record<string, unknown>;
}

async function getStatus(deps: Deps, path: string): Promise<string> {
    const res = await deps.fetchFn(`${deps.baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${deps.token}` },
    });
    if (!res.ok) {
        throw new Error(`GET ${path} returned HTTP ${res.status}`);
    }
    const data = (await res.json()) as { status?: string };
    return data.status ?? 'unknown';
}

/**
 * Starts one scanner and polls its status until terminal. Resolves on
 * "completed"; throws on "failed", timeout, or transport error (fail closed).
 */
export async function runScanner(deps: Deps, scanner: Scanner, targetUrl: string): Promise<void> {
    const spec = SCANNERS[scanner];
    const started = await postJson(deps, spec.start, spec.body(targetUrl));
    const scanId = started.scanId as string | undefined;
    if (!scanId) throw new Error(`${scanner}: start response had no scanId`);

    process.stdout.write(`[DastSuite] ${scanner} started (scanId ${scanId})\n`);

    const deadline = deps.now() + POLL_TIMEOUT_MS;
    for (;;) {
        if (deps.now() > deadline) {
            throw new Error(`${scanner}: scan ${scanId} timed out after ${POLL_TIMEOUT_MS}ms`);
        }
        await deps.sleep(POLL_INTERVAL_MS);
        const status = await getStatus(deps, spec.status(scanId));
        if (status === 'completed') {
            process.stdout.write(`[DastSuite] ${scanner} completed\n`);
            return;
        }
        if (status === 'failed') {
            throw new Error(`${scanner}: scan ${scanId} reported failed`);
        }
    }
}

export function parseScanners(raw: string | undefined): Scanner[] {
    if (!raw) return ['zap', 'nuclei', 'ffuf'];
    const valid: Scanner[] = ['zap', 'nuclei', 'ffuf'];
    const picked = raw.split(',').map((s) => s.trim().toLowerCase());
    const result = valid.filter((s) => picked.includes(s));
    if (result.length === 0) {
        throw new Error(`DAST_SCANNERS "${raw}" matched none of: ${valid.join(', ')}`);
    }
    return result;
}

export async function main(): Promise<void> {
    const deps: Deps = {
        baseUrl: requireEnv('SCORPION_API_URL').replace(/\/+$/, ''),
        token: requireEnv('SCORPION_API_TOKEN'),
        fetchFn: fetch,
        sleep: delay,
        now: Date.now,
    };
    const targetUrl = requireEnv('DAST_TARGET_URL');
    const scanners = parseScanners(process.env.DAST_SCANNERS);

    process.stdout.write(`[DastSuite] Running [${scanners.join(', ')}] against ${targetUrl}\n`);

    // Run sequentially — a single shared ZAP instance can't scan concurrently,
    // and sequential keeps the staging box under the per-scanner rate caps.
    for (const scanner of scanners) {
        await runScanner(deps, scanner, targetUrl);
    }

    process.stdout.write(`[DastSuite] All scans completed. Gate can now be evaluated.\n`);
    process.exit(0);
}

if (require.main === module) {
    main().catch((err) => {
        process.stderr.write(`[DastSuite] ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
    });
}
