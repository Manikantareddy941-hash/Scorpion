import { AUDIT_ANCHOR_EVENT } from './auditAnchor';
import type { VerificationReport, ChainSample } from './auditVerifier';

/**
 * Cross-checks the Appwrite ledger against the off-box anchors in Loki.
 *
 * THE THREAT THIS EXISTS FOR
 *
 * auditVerifier proves the chain is internally consistent. That is worth little on
 * its own: an attacker holding APPWRITE_API_KEY can delete a row, recompute every
 * subsequent tamper_hash, and auditVerifier will report `isValid: true` over a
 * ledger that has been rewritten. Internal consistency is a property the attacker
 * controls.
 *
 * The anchors are not. They were pushed to Loki at write time, over a different
 * protocol, with a different credential. Rewriting the database does not rewrite
 * them. So a row whose hash disagrees with its anchor is evidence of exactly the
 * attack the internal verifier cannot see.
 *
 * WHY NOT `API_KEY_COMPROMISE_DETECTED`
 *
 * Because a hash disagreement is not proof of compromise, and naming it that way
 * guarantees the first false positive gets the whole check muted. An anchor can be
 * absent because Loki retention expired it, because a push failed during an
 * outage, or because the anchor was emitted by a build that predates sequencing.
 * Those are different incidents with different responses, so they get different
 * statuses. The person woken at 3am needs to know which one they are looking at.
 *
 * WHAT AN UNCONFIGURED LOKI MEANS
 *
 * ANCHOR_UNAVAILABLE, never MATCH. A verifier that returns "fine" because it had
 * nothing to check against is the counterfeit health signal this whole audit has
 * been about. Silence is not agreement.
 */

/** Order matters: index 0 is the most serious. Used to reduce many checks to one verdict. */
const SEVERITY = ['ANCHOR_MISMATCH', 'ANCHOR_UNAVAILABLE', 'ANCHOR_MISSING', 'MATCH'] as const;
export type AnchorStatus = (typeof SEVERITY)[number];

export interface AnchorCheck {
    status: AnchorStatus;
    sequence: number;
    recordId: string;
    dbHash: string;
    anchorHash?: string;
    detail: string;
}

export interface AnchorVerificationReport {
    /** The most serious status across every sample. */
    status: AnchorStatus;
    /** True only when every sample matched AND at least one sample was actually checked. */
    verified: boolean;
    lokiConfigured: boolean;
    checked: number;
    checks: AnchorCheck[];
}

/** Loki returns each entry as a [nanosecondTimestamp, logLine] tuple. */
type LokiStreamValue = readonly [string, string];
interface LokiResponse { data?: { result?: Array<{ values?: LokiStreamValue[] }> } }

const QUERY_TIMEOUT_MS = 10_000;
/** How far back to look for an anchor. Wider than any plausible clock skew, narrower than retention. */
const LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

function worstOf(statuses: readonly AnchorStatus[]): AnchorStatus {
    for (const s of SEVERITY) if (statuses.includes(s)) return s;
    return 'MATCH';
}

/**
 * Loki's push endpoint and query endpoint are usually the same host, but not
 * always — a write path may point at a distributor while reads go through a
 * query-frontend. LOKI_QUERY_URL exists so those can differ without repurposing
 * the push URL and silently querying the wrong service.
 */
function queryBase(): string | undefined {
    return process.env.LOKI_QUERY_URL || process.env.LOKI_URL || undefined;
}

function authHeaders(): Record<string, string> {
    const token = process.env.LOKI_QUERY_TOKEN;
    return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Pulls anchor lines from Loki and indexes them by sequence.
 *
 * Filters client-side rather than leaning on Loki's `| json | sequence="n"` pipeline:
 * the parser stage silently drops lines it cannot parse, so a malformed anchor would
 * read as an absent one. Fetching the stream and matching here keeps "no anchor" and
 * "unparseable anchor" distinguishable.
 */
async function fetchAnchors(now: number): Promise<Map<number, string>> {
    const base = queryBase()!.replace(/\/+$/, '');
    const params = new URLSearchParams({
        query: '{app="scorpion", stream="audit_anchor"}',
        start: String((now - LOOKBACK_MS) * 1_000_000), // Loki wants nanoseconds
        end: String(now * 1_000_000),
        limit: '5000',
        direction: 'backward',
    });

    const res = await fetch(`${base}/loki/api/v1/query_range?${params}`, {
        headers: { Accept: 'application/json', ...authHeaders() },
        signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Loki query returned ${res.status}`);

    const body = (await res.json()) as LokiResponse;

    // Keyed by position, holding the EARLIEST anchor seen for it — compared by the
    // timestamp Loki returns, never by iteration order.
    //
    // An earlier version kept "the first entry encountered" while querying
    // direction=backward, which returns newest-first: a forged anchor re-emitted to
    // match a rewritten row would have been kept and the authentic one discarded.
    // The unit test passed only because its fixture happened to list the original
    // first, which is not how Loki orders a backward query — the mock modelled the
    // behaviour the code wanted rather than the behaviour it had.
    //
    // Switching to direction=forward would fix the ordering and break something
    // worse: with a limit, forward returns the OLDEST entries in the window, so on
    // a busy ledger the tip anchor falls outside the response and the most
    // important sample reports ANCHOR_MISSING. Backward keeps recent coverage;
    // explicit timestamp comparison makes the ordering irrelevant either way.
    const bySequence = new Map<number, { hash: string; ts: bigint }>();

    for (const stream of body.data?.result ?? []) {
        for (const [ts, line] of stream.values ?? []) {
            let parsed: Record<string, unknown>;
            try {
                parsed = JSON.parse(line);
            } catch {
                continue; // not an anchor line we can read; absence is reported per-sample
            }
            if (parsed.event !== AUDIT_ANCHOR_EVENT) continue;
            const seq = parsed.sequence;
            const hash = parsed.tamperHash;
            if (typeof seq !== 'number' || typeof hash !== 'string') continue;

            let at: bigint;
            try {
                at = BigInt(ts); // nanosecond precision exceeds Number's safe integer range
            } catch {
                continue;
            }

            const held = bySequence.get(seq);
            if (held === undefined || at < held.ts) bySequence.set(seq, { hash, ts: at });
        }
    }

    return new Map([...bySequence].map(([seq, v]) => [seq, v.hash]));
}

function unavailable(samples: readonly ChainSample[], detail: string, lokiConfigured: boolean): AnchorVerificationReport {
    return {
        status: 'ANCHOR_UNAVAILABLE',
        verified: false,
        lokiConfigured,
        checked: 0,
        checks: samples.map((s) => ({
            status: 'ANCHOR_UNAVAILABLE' as const,
            sequence: s.sequence,
            recordId: s.recordId,
            dbHash: s.tamperHash,
            detail,
        })),
    };
}

/**
 * Compares the sampled chain positions from auditVerifier against Loki.
 *
 * `verified` is true only when something was actually checked and everything
 * matched. An empty sample set — a ledger with no sequenced rows yet — is NOT a
 * pass; there is simply nothing to say, and saying "verified" would be a lie of
 * omission.
 */
export async function verifyAnchorIntegrity(
    // Only `samples` is ever read, so this accepts a tail report as readily as a
    // full one. Narrowing the parameter to what is actually used means the
    // scheduled tail pass can cross-check anchors without either report type
    // having to pretend to be the other.
    dbReport: Pick<VerificationReport, 'samples'>,
    now: number = Date.now(),
): Promise<AnchorVerificationReport> {
    const samples = dbReport.samples;

    if (!queryBase()) {
        return unavailable(
            samples,
            'Neither LOKI_QUERY_URL nor LOKI_URL is set, so no off-box anchor could be read. ' +
            'The ledger has NOT been cross-checked — an internally valid chain proves nothing against ' +
            'an attacker who can write the database.',
            false,
        );
    }

    if (samples.length === 0) {
        return {
            status: 'ANCHOR_UNAVAILABLE',
            verified: false,
            lokiConfigured: true,
            checked: 0,
            checks: [],
        };
    }

    let anchors: Map<number, string>;
    try {
        anchors = await fetchAnchors(now);
    } catch (err) {
        return unavailable(
            samples,
            `Loki query failed (${err instanceof Error ? err.message : String(err)}). ` +
            'Cannot distinguish an intact ledger from a rewritten one while this persists.',
            true,
        );
    }

    const checks: AnchorCheck[] = samples.map((s) => {
        const anchorHash = anchors.get(s.sequence);

        if (anchorHash === undefined) {
            return {
                status: 'ANCHOR_MISSING' as const,
                sequence: s.sequence,
                recordId: s.recordId,
                dbHash: s.tamperHash,
                detail:
                    `no anchor found for position ${s.sequence}. Likely causes, in order: the anchor aged out of ` +
                    'Loki retention; the anchor push failed during an outage; the row predates anchoring. ' +
                    'A row DELETED from the ledger does not produce this — it produces a GAP in the internal report.',
            };
        }

        if (anchorHash !== s.tamperHash) {
            return {
                status: 'ANCHOR_MISMATCH' as const,
                sequence: s.sequence,
                recordId: s.recordId,
                dbHash: s.tamperHash,
                anchorHash,
                detail:
                    `position ${s.sequence} hashes differently in the ledger (${s.tamperHash.slice(0, 12)}…) than in ` +
                    `the anchor recorded when it was written (${anchorHash.slice(0, 12)}…). The anchor cannot be ` +
                    'edited through Appwrite, so the ledger row changed after the fact. If the internal verifier ' +
                    'also reports isValid, the chain was recomputed — which requires database write access.',
            };
        }

        return {
            status: 'MATCH' as const,
            sequence: s.sequence,
            recordId: s.recordId,
            dbHash: s.tamperHash,
            anchorHash,
            detail: `position ${s.sequence} matches the anchor written at the time of the event`,
        };
    });

    const status = worstOf(checks.map((c) => c.status));
    return {
        status,
        verified: status === 'MATCH' && checks.length > 0,
        lokiConfigured: true,
        checked: checks.length,
        checks,
    };
}
