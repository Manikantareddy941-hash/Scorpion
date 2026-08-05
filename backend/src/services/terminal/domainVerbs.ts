import { register, CommandError, type TerminalCommand, type TerminalContext } from './commands';
import { checkReleaseGate } from '../gateService';
import { canAccessResource } from '../tenancyService';
import { getProvenance } from '../imageStore';
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

let registered = false;

export function registerDomainVerbs(): void {
    if (registered) return;
    [gateStatus, pipelineLs, provenanceShow].forEach(register);
    registered = true;
}

/** Test seam — pairs with __resetRegistryForTests(). */
export function __resetDomainVerbsForTests(): void {
    registered = false;
}
