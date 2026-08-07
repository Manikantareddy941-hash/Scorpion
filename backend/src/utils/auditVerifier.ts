import crypto from 'crypto';
import { databases, DB_ID, Query } from '../lib/appwrite';

/**
 * Walks audit_logs_v2 and reports whether the chain still holds.
 *
 * This is the read path the ledger never had. Until it existed, tamper_hash was
 * written on every row and consulted only to chain the next one — hashing with no
 * verifier, which is the same shape as the write-only provenance path: a property
 * asserted in code comments and never once checked.
 *
 * WHAT THIS CAN AND CANNOT PROVE
 *
 * Running against Appwrite alone, this detects accidental corruption and a
 * careless edit. It does NOT detect a competent attacker holding
 * APPWRITE_API_KEY: they can delete a row and recompute every subsequent hash,
 * and this verifier will report a perfectly valid chain. Detecting that requires
 * comparing against the off-box anchors in Loki (utils/auditAnchor), which is a
 * separate input this module deliberately does not reach for — a verifier that
 * silently degrades to "database says it's fine" would be worse than none, and
 * the caller should choose that comparison explicitly.
 *
 * Report honestly, and let the caller decide what a clean result is worth.
 */

const COLLECTION = 'audit_logs_v2';
const PAGE_SIZE = 100;

export type VerificationErrorKind =
    /** Stored hash does not match a recomputation over the row's own fields. */
    | 'BROKEN_LINK'
    /** Two or more rows claim the same position, chained to the same predecessor. */
    | 'FORK'
    /** Positions skip — the usual cause is a deleted row. */
    | 'GAP'
    /** A legacy (unsequenced) row appears after sequencing began. */
    | 'SEQUENCE_REGRESSION';

export interface VerificationError {
    kind: VerificationErrorKind;
    recordId: string;
    sequence?: number;
    detail: string;
}

/**
 * A (position, hash) pair lifted out of the chain so it can be checked against the
 * off-box anchors.
 *
 * The report carries these because a hash-only verdict is not cross-checkable: an
 * attacker who rewrites the ledger produces a chain that verifies internally, and
 * catching that needs the actual hashes compared against something outside the
 * database. `isValid: true` plus counts is not enough to do that with.
 */
export interface ChainSample {
    sequence: number;
    recordId: string;
    tamperHash: string;
}

export interface VerificationReport {
    isValid: boolean;
    rowsChecked: number;
    /** Highest position seen. Undefined when the ledger predates sequencing entirely. */
    latestSequence?: number;
    /** Rows written before the sequence attribute existed. Not an error. */
    legacyRows: number;
    errors: VerificationError[];
    /**
     * The chain tip plus evenly spaced earlier positions, for anchor cross-checking.
     *
     * The tip alone would miss a rewrite of old history that left recent rows intact —
     * which is the shape of the attack you would actually mount, since nobody reads
     * old audit rows. Sampling backwards costs one Loki lookup per sample and makes
     * a silent historical rewrite something you can trip over.
     */
    samples: ChainSample[];
}

/** How many positions to cross-check, tip included. */
const SAMPLE_COUNT = 5;

function sampleChain(rows: readonly LedgerRow[]): ChainSample[] {
    const sequenced = rows.filter((r): r is LedgerRow & { sequence: number } => typeof r.sequence === 'number');
    if (sequenced.length === 0) return [];

    // Always include the tip; spread the rest across the chain rather than clustering
    // at one end, so a rewrite has nowhere uniformly safe to hide.
    const picked = new Map<number, ChainSample>();
    const step = Math.max(1, Math.floor(sequenced.length / SAMPLE_COUNT));
    for (let i = sequenced.length - 1; i >= 0 && picked.size < SAMPLE_COUNT; i -= step) {
        const row = sequenced[i];
        picked.set(row.sequence, { sequence: row.sequence, recordId: row.$id, tamperHash: row.tamper_hash });
    }
    return [...picked.values()].sort((a, b) => a.sequence - b.sequence);
}

interface LedgerRow {
    $id: string;
    actor: string;
    action: string;
    repo_id: string;
    timestamp: string;
    details: string;
    tamper_hash: string;
    sequence?: number;
}

/**
 * Rebuilds the payload exactly as logSecureAuditEvent wrote it.
 *
 * The format changed when sequences were introduced, and the selector is the
 * presence of a sequence on the row itself rather than a version column or a
 * cutoff date. Guessing wrong reports every row on one side of the boundary as
 * BROKEN_LINK — a verifier that cries wolf gets muted, and takes the real signal
 * with it.
 */
export function payloadFor(row: LedgerRow): string {
    const base = `${row.actor}|${row.action}|${row.repo_id}|${row.timestamp}|${row.details}`;
    return typeof row.sequence === 'number' ? `${row.sequence}|${base}` : base;
}

function hashOf(predecessor: string, row: LedgerRow): string {
    return crypto.createHash('sha256').update(`${predecessor}|${payloadFor(row)}`).digest('hex');
}

/**
 * What the row before `rows[0]` was, when verifying a slice rather than the whole
 * ledger. Absent means the slice starts at the genesis of the chain.
 */
export interface ChainSeed {
    /** tamper_hash of the row immediately preceding the slice. */
    hash: string;
    /** Its position, so a gap at the slice boundary is still caught. */
    sequence?: number;
}

/**
 * Verifies an already-loaded, ascending-order run of rows.
 *
 * Separated from fetching so it is testable without a database, and so a caller
 * holding rows from elsewhere (a backup, an export) can check those instead.
 *
 * `seed` exists for tail verification. Without it the walk assumes `rows[0]`
 * chains to GENESIS, which is true only for a full walk — handing a mid-ledger
 * slice to the unseeded form reports its first row as BROKEN_LINK every time,
 * turning a healthy chain into a false tamper alert.
 */
export function verifyChain(rows: readonly LedgerRow[], seed?: ChainSeed): VerificationReport {
    const errors: VerificationError[] = [];
    let legacyRows = 0;
    let latestSequence: number | undefined;

    // Hash of the row immediately before the current one, positionally.
    let previousRowHash = seed?.hash ?? 'GENESIS_HASH';
    // Hash the current *cohort* chained to. Rows sharing a position all chained to
    // the same predecessor, so a fork must be validated against that — not against
    // its sibling. Validating positionally would report the second writer as
    // BROKEN_LINK, mislabelling a benign race as tampering.
    let cohortPredecessor = seed?.hash ?? 'GENESIS_HASH';
    let previousSequence: number | undefined = seed?.sequence;

    for (const row of rows) {
        const sequence = typeof row.sequence === 'number' ? row.sequence : undefined;
        const isDuplicate = sequence !== undefined && sequence === previousSequence;
        const predecessor = isDuplicate ? cohortPredecessor : previousRowHash;

        if (hashOf(predecessor, row) !== row.tamper_hash) {
            errors.push({
                kind: 'BROKEN_LINK',
                recordId: row.$id,
                sequence,
                detail:
                    `stored tamper_hash does not match a recomputation over this row's fields ` +
                    `chained to ${predecessor.slice(0, 12)}… — the row was edited, or the row before it was removed`,
            });
        }

        if (sequence === undefined) {
            legacyRows += 1;
            if (previousSequence !== undefined) {
                errors.push({
                    kind: 'SEQUENCE_REGRESSION',
                    recordId: row.$id,
                    detail: `unsequenced row appears after position ${previousSequence}; sequencing does not run backwards`,
                });
            }
        } else {
            if (isDuplicate) {
                errors.push({
                    kind: 'FORK',
                    recordId: row.$id,
                    sequence,
                    detail:
                        `position ${sequence} is claimed more than once — two writers read the same tip and both appended. ` +
                        `Expected under concurrency (appends are deliberately unlocked); investigate only if it is frequent or correlated with a security event`,
                });
            } else if (previousSequence !== undefined && sequence !== previousSequence + 1) {
                errors.push({
                    kind: 'GAP',
                    recordId: row.$id,
                    sequence,
                    detail: `position jumps ${previousSequence} → ${sequence}; ${sequence - previousSequence - 1} row(s) are missing`,
                });
            }
            // previousSequence === undefined && sequence === 0 falls through
            // deliberately: that is the migration boundary, where sequencing began
            // after a run of legacy rows. It is neither a gap nor a restart.

            latestSequence = latestSequence === undefined ? sequence : Math.max(latestSequence, sequence);
        }

        cohortPredecessor = predecessor;
        previousRowHash = row.tamper_hash;
        previousSequence = sequence;
    }

    return {
        isValid: errors.length === 0,
        rowsChecked: rows.length,
        latestSequence,
        legacyRows,
        errors,
        samples: sampleChain(rows),
    };
}

/**
 * Loads the whole ledger oldest-first and verifies it.
 *
 * Pages explicitly. Appwrite caps a listDocuments response, and a verifier that
 * stopped at the first page would report a clean chain having examined a prefix of
 * it — the same failure as a scan that reports no findings after examining no
 * files. A short page is the only stop condition.
 */
/**
 * The result of checking only the recent end of the ledger.
 *
 * DELIBERATELY NOT A VerificationReport, and deliberately WITHOUT an `isValid`
 * boolean.
 *
 * A tail walk can prove the links inside its window hold. It cannot prove the
 * ledger is intact: an attacker who rewrote old history and recomputed every hash
 * forward produces a tail that verifies perfectly. Returning the full-walk shape
 * would let a caller — or a dashboard six months from now — read `isValid: true`
 * from a 1000-row window and conclude the whole chain is sound. Making the type
 * different means that mistake cannot be made silently; the compiler asks.
 *
 * What this IS good for: catching tampering promptly, and cross-checking fresh
 * positions against the off-box anchors while they are still within Loki
 * retention. The full walk (verifyAuditChain) remains the only thing that can
 * speak about the ledger as a whole.
 */
export interface TailVerificationReport {
    scope: 'tail';
    /** Rows actually verified — excludes the predecessor row used only as a seed. */
    rowsChecked: number;
    /** Lowest position in the verified window. */
    windowFrom?: number;
    /** Highest position seen, i.e. the chain tip. */
    latestSequence?: number;
    legacyRows: number;
    errors: VerificationError[];
    samples: ChainSample[];
}

/** How many rows the 15-minute pass examines. */
export const TAIL_WINDOW = 1000;

/**
 * Verifies the most recent `windowSize` rows.
 *
 * Fetches one row MORE than the window: the extra oldest row is not itself
 * verified — its own hash cannot be checked without ITS predecessor — but its
 * tamper_hash and sequence seed the walk, so the first row of the real window is
 * validated against what actually precedes it rather than against GENESIS.
 *
 * Cost is bounded by windowSize regardless of ledger size. That is the entire
 * point: the full walk is O(N) against a collection that only grows, which is not
 * something to run every fifteen minutes.
 */
export async function verifyAuditTail(windowSize: number = TAIL_WINDOW): Promise<TailVerificationReport> {
    const page = await databases.listDocuments(DB_ID, COLLECTION, [
        Query.orderDesc('$createdAt'),
        Query.limit(windowSize + 1),
    ]);

    // Appwrite returned newest-first; the walk needs oldest-first.
    const descending = page.documents as unknown as LedgerRow[];
    const ascending = [...descending].reverse();

    // A short page means we reached the start of the ledger, so there is no
    // predecessor to seed from and rows[0] genuinely chains to GENESIS.
    const reachedGenesis = ascending.length <= windowSize;
    const seedRow = reachedGenesis ? undefined : ascending[0];
    const window = reachedGenesis ? ascending : ascending.slice(1);

    const report = verifyChain(
        window,
        seedRow ? { hash: seedRow.tamper_hash, sequence: seedRow.sequence } : undefined,
    );

    // isValid is dropped on purpose — see the type's comment. Everything else is
    // carried through unchanged so the caller sees the same evidence.
    return {
        scope: 'tail',
        rowsChecked: report.rowsChecked,
        windowFrom: window.find((r) => typeof r.sequence === 'number')?.sequence,
        latestSequence: report.latestSequence,
        legacyRows: report.legacyRows,
        errors: report.errors,
        samples: report.samples,
    };
}

export async function verifyAuditChain(): Promise<VerificationReport> {
    const rows: LedgerRow[] = [];

    for (;;) {
        const page = await databases.listDocuments(DB_ID, COLLECTION, [
            Query.orderAsc('$createdAt'),
            Query.limit(PAGE_SIZE),
            Query.offset(rows.length),
        ]);
        const batch = page.documents as unknown as LedgerRow[];
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) break;
    }

    return verifyChain(rows);
}
