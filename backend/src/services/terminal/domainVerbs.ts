import { register, CommandError, type TerminalCommand, type TerminalContext } from './commands';
import { checkReleaseGate } from '../gateService';
import { canAccessResource } from '../tenancyService';
import { getProvenance } from '../imageStore';
import { runFullAuditVerification, isTamperSuspected, type FullAuditReport } from '../../utils/auditOrchestrator';
import { databases, DB_ID, COLLECTIONS, Query } from '../../lib/appwrite';

/**
 * SecOps domain verbs for the Scorpion Terminal.
 *
 * Every handler calls the same service layer the HTTP routes use, so a verb
 * inherits the tenancy checks and audit behaviour already tested there rather
 * than reimplementing them. Where a route scopes a query to the caller's
 * accessible repos, the verb copies that scoping exactly — a terminal is not a
 * reason to widen what a user can read.
 *
 * All three are read-only, hence `mutating: false`. The first mutating verb
 * added here flips the route's audit path to fail-closed automatically; that is
 * what the required `mutating` field on TerminalCommand exists for.
 */

/** Bounded so a verb cannot pull the whole collection into a terminal pane. */
const LIST_LIMIT = 20;
const REPO_SCAN_LIMIT = 500;

function requireArg(args: readonly string[], name: string, usage: string): string {
    const value = args[0];
    if (!value) throw new CommandError(`missing <${name}> — usage: ${usage}`);
    return value;
}

/**
 * Resolves a repo the caller may actually see. Returns the document so callers
 * can read fields from it; throws 403-equivalent otherwise.
 *
 * Deliberately does not distinguish "no such repo" from "not yours": that
 * difference is a membership oracle for repo ids.
 */
async function assertRepoVisible(repoId: string, ctx: TerminalContext) {
    const repo = await databases
        .getDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId)
        .catch(() => null);
    if (!repo || !(await canAccessResource(repo, ctx.userId))) {
        throw new CommandError(`no accessible repository '${repoId}'`, 403);
    }
    return repo;
}

const gateStatus: TerminalCommand = {
    name: 'gate',
    summary: 'Show the release gate verdict for a repository.',
    usage: 'gate status <repoId>',
    maxArgs: 2,
    mutating: false,
    handler: async (args, ctx) => {
        const [sub, repoId] = args;
        if (sub !== 'status') throw new CommandError("usage: gate status <repoId>");
        if (!repoId) throw new CommandError('missing <repoId> — usage: gate status <repoId>');

        await assertRepoVisible(repoId, ctx);
        const result = await checkReleaseGate(repoId);

        const lines = [
            `repo:      ${repoId}`,
            `verdict:   ${result.allowed ? 'PASSING' : 'BLOCKED'}`,
            `score:     ${result.score}% (minimum ${result.minSecurityScore}%)`,
            `blockers:  ${result.blocker_count}`,
        ];

        if (result.regoDenyReasons?.length) {
            lines.push('', 'policy denials:');
            result.regoDenyReasons.slice(0, LIST_LIMIT).forEach((r) => lines.push(`  - ${r}`));
        }

        if (result.blocker_count > 0) {
            lines.push('', `top blockers (showing ${Math.min(result.blockers.length, LIST_LIMIT)}):`);
            result.blockers.slice(0, LIST_LIMIT).forEach((b) => {
                const severity = (b.severity ?? 'unknown').toUpperCase();
                const pkg = b.packageName ?? b.package;
                const label = b.title ?? 'unnamed finding';
                lines.push(`  ${severity.padEnd(9)}${label}${pkg ? ` (${pkg})` : ''}`);
            });
        }

        return lines;
    },
};

const pipelineLs: TerminalCommand = {
    name: 'pipeline',
    summary: 'List recent pipeline runs you have access to.',
    usage: 'pipeline ls [repoId]',
    maxArgs: 2,
    mutating: false,
    handler: async (args, ctx) => {
        const [sub, repoId] = args;
        if (sub !== 'ls') throw new CommandError('usage: pipeline ls [repoId]');

        const queries: string[] = [Query.orderDesc('$createdAt'), Query.limit(LIST_LIMIT)];

        if (repoId) {
            await assertRepoVisible(repoId, ctx);
            queries.push(Query.equal('repoId', repoId));
        } else {
            // Same scoping as GET /api/pipelines/runs: without a repo filter,
            // restrict to repos this caller owns rather than listing the system.
            const owned = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
                Query.equal('user_id', ctx.userId),
                Query.limit(REPO_SCAN_LIMIT),
            ]);
            const ids = owned.documents.map((r) => r.$id);
            if (ids.length === 0) return ['No repositories accessible to you, so no pipeline runs to show.'];
            queries.push(Query.equal('repoId', ids));
        }

        const runs = await databases.listDocuments(DB_ID, 'pipeline_runs', queries);
        if (runs.documents.length === 0) return ['No pipeline runs found.'];

        const lines = [
            `${'RUN'.padEnd(22)}${'REPO'.padEnd(22)}${'STATUS'.padEnd(12)}COMMIT`,
        ];
        runs.documents.forEach((run) => {
            const doc = run as unknown as Record<string, unknown>;
            const commit = typeof doc.commitSha === 'string' ? doc.commitSha.slice(0, 8) : '—';
            lines.push(
                String(run.$id).slice(0, 20).padEnd(22) +
                String(doc.repoId ?? '—').slice(0, 20).padEnd(22) +
                String(doc.status ?? '—').padEnd(12) +
                commit,
            );
        });
        lines.push('', `${runs.documents.length} run(s) shown, newest first.`);
        return lines;
    },
};

const provenanceShow: TerminalCommand = {
    name: 'provenance',
    summary: 'Show the recorded SLSA provenance for an image digest.',
    usage: 'provenance show <digest>',
    maxArgs: 2,
    // Admin-only, deliberately. Provenance is stored in the image cache keyed by
    // tenant, and a terminal session carries an Appwrite user id, not the CI
    // tenant that wrote the entry — this deployment writes under the legacy
    // global namespace (imageStore.Tenant = null) because CI authenticates with
    // the shared CI_INGEST_API_KEY. Until that mapping exists, reading is
    // restricted to admins rather than served to every authenticated user.
    allowedRoles: ['admin'],
    mutating: false,
    handler: async (args) => {
        const [sub] = args;
        if (sub !== 'show') throw new CommandError('usage: provenance show <digest>');
        const digest = requireArg(args.slice(1), 'digest', 'provenance show <digest>');

        const raw = await getProvenance(null, digest);
        if (!raw) {
            return [
                `No provenance on record for ${digest}.`,
                '',
                'Provenance is cached for one hour after a build attests it, so an',
                'absent record means either no attestation ran or the entry expired.',
                'Absence is not evidence the image is unattested.',
            ];
        }

        // Rendered as parsed fields rather than raw JSON: the statement is large,
        // and a terminal pane showing 200 lines of JSON is not an answer.
        try {
            const statement = JSON.parse(raw) as {
                predicateType?: string;
                subject?: Array<{ name?: string; digest?: Record<string, string> }>;
                predicate?: { builder?: { id?: string }; buildType?: string; metadata?: { buildStartedOn?: string } };
            };
            const subject = statement.subject?.[0];
            return [
                `digest:    ${digest}`,
                `predicate: ${statement.predicateType ?? 'unknown'}`,
                `buildType: ${statement.predicate?.buildType ?? 'unknown'}`,
                `builder:   ${statement.predicate?.builder?.id ?? 'unknown'}`,
                `started:   ${statement.predicate?.metadata?.buildStartedOn ?? 'unknown'}`,
                `subject:   ${subject?.name ?? 'unnamed'}`,
                '',
                `${raw.length} bytes on record.`,
            ];
        } catch {
            // Stored provenance that will not parse is itself the finding.
            throw new CommandError(`provenance for ${digest} is on record but is not valid JSON`);
        }
    },
};

/**
 * Renders a FullAuditReport for a terminal pane.
 *
 * The pane colours a whole response, not individual lines, so severity is spelled
 * out in words rather than implied by colour. That is the more durable choice here
 * anyway: this output gets pasted into incident notes, where colour does not survive.
 */
function formatAuditReport(report: FullAuditReport): string[] {
    const { db, anchor } = report;

    const rowSummary = [
        `${db.rowsChecked} checked`,
        db.latestSequence !== undefined ? `latest position ${db.latestSequence}` : 'no sequenced rows',
        db.legacyRows > 0 ? `${db.legacyRows} legacy (pre-sequencing)` : null,
    ].filter(Boolean).join(' · ');

    const lines = [
        `audit ledger verification — ${report.timestamp}`,
        '',
        `  chain:    ${db.isValid ? 'VALID' : `INVALID — ${db.errors.length} problem(s)`}`,
        `  anchors:  ${anchor.status}`,
        `  rows:     ${rowSummary}`,
        `  sampled:  ${anchor.checked} of ${db.samples.length} position(s) cross-checked against Loki`,
    ];

    if (!db.isValid) {
        lines.push('', 'chain problems:');
        db.errors.slice(0, LIST_LIMIT).forEach((e) => {
            lines.push(`  ${e.kind.padEnd(22)}${(e.sequence !== undefined ? `seq ${e.sequence}` : 'unsequenced').padEnd(18)}${e.recordId}`);
            lines.push(`    ${e.detail}`);
        });
        if (db.errors.length > LIST_LIMIT) {
            lines.push(`  … ${db.errors.length - LIST_LIMIT} further problem(s) not shown`);
        }
    }

    const failedChecks = anchor.checks.filter((c) => c.status !== 'MATCH');
    if (failedChecks.length > 0) {
        lines.push('', 'anchor checks:');
        failedChecks.slice(0, LIST_LIMIT).forEach((c) => {
            lines.push(`  ${c.status.padEnd(22)}seq ${c.sequence}`);
            lines.push(`    ${c.detail}`);
        });
    }

    // The three-way verdict is the point of the whole verb. "Internally valid" and
    // "verified against off-box anchors" are different claims, and collapsing them
    // into one PASS would hand an operator the exact false assurance the anchor
    // verifier was written to prevent.
    lines.push('');
    if (isTamperSuspected(report)) {
        lines.push(
            'VERDICT: TAMPER EVIDENCE. The ledger does not match what was recorded when',
            'the events happened. Treat the audit trail as untrustworthy until explained,',
            'and note that recomputing the chain requires database write access.',
        );
    } else if (anchor.verified) {
        lines.push('VERDICT: intact — chain consistent AND cross-checked against off-box anchors.');
    } else {
        lines.push(
            'VERDICT: chain is internally consistent but was NOT cross-checked.',
            `Anchor status ${anchor.status}${anchor.lokiConfigured ? '' : ' (Loki is not configured)'} — an attacker holding`,
            'the database credential can produce a chain that verifies internally, so this',
            'result does not rule that out. This is not a pass.',
        );
    }

    return lines;
}

/**
 * Per-user cooldown for `audit verify`.
 *
 * One run pages the ENTIRE ledger out of Appwrite and then queries Loki, so the cost
 * per call grows with the ledger and is unbounded. The route's auditVerifyLimiter
 * caps HTTP traffic to /api/audit/verify, but it cannot see this verb: terminal
 * commands all arrive as POST /api/terminal/exec, so without a cooldown here the
 * expensive work stays reachable through an endpoint budgeted for cheap interactive
 * typing.
 *
 * ponytail: in-process Map, so the cooldown is per backend instance — N replicas
 * allow N runs per window. Acceptable ceiling for a limit whose job is stopping a
 * human at a prompt from hammering an expensive read. Move it next to the other
 * shared counters in Redis if it ever has to hold across instances.
 */
const AUDIT_VERIFY_COOLDOWN_MS = 3 * 60 * 1000;
const lastAuditVerifyByUser = new Map<string, number>();

function assertNotCoolingDown(userId: string, now: number): void {
    const last = lastAuditVerifyByUser.get(userId);
    if (last === undefined) return;

    const remainingMs = AUDIT_VERIFY_COOLDOWN_MS - (now - last);
    if (remainingMs > 0) {
        throw new CommandError(
            `'audit verify' is rate limited — try again in ${Math.ceil(remainingMs / 1000)}s. ` +
            'Each run replays the whole ledger and queries Loki.',
            429,
            'audit',
        );
    }
}

const auditVerify: TerminalCommand = {
    name: 'audit',
    summary: 'Verify the audit ledger chain and cross-check it against off-box anchors.',
    usage: 'audit verify',
    maxArgs: 1,
    // The report names broken positions, record ids and tamper hashes, and states
    // whether off-box anchoring is configured — a map of where the ledger is weakest,
    // which is reconnaissance for the attack it exists to detect. 'security' is
    // included because investigating ledger integrity is that role's job; every other
    // role gets a 403, never a redacted answer.
    allowedRoles: ['admin', 'security'],
    // Read-only: a chain walk plus Loki queries. No writes, no checkpoint, no lock.
    mutating: false,
    handler: async (args, ctx) => {
        if (args[0] !== 'verify') throw new CommandError('usage: audit verify');

        const now = Date.now();
        assertNotCoolingDown(ctx.userId, now);

        // Stamped BEFORE the run, not after. Recording on completion would leave a
        // second call free to start while the first is still paging the ledger —
        // the window where the cost is actually incurred is exactly the one to close.
        lastAuditVerifyByUser.set(ctx.userId, now);

        return formatAuditReport(await runFullAuditVerification());
    },
};

/** Test seam. The cooldown is process-global and would otherwise leak between tests. */
export function __resetAuditVerifyCooldownForTests(): void {
    lastAuditVerifyByUser.clear();
}

let registered = false;

export function registerDomainVerbs(): void {
    if (registered) return;
    [gateStatus, pipelineLs, provenanceShow, auditVerify].forEach(register);
    registered = true;
}

/** Test seam — pairs with __resetRegistryForTests(). */
export function __resetDomainVerbsForTests(): void {
    registered = false;
}
