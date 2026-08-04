import { Router, type Request, type Response } from 'express';
import { terminalLimiter } from '../middleware/rateLimiters';
import { resolveRole } from '../middleware/requireRole';
import { logSecureAuditEvent } from '../utils/tamperAuditLogger';
import { logger } from '../services/logger';
import { dispatch, listCommands, CommandError, type TerminalContext } from '../services/terminal/commands';
import { registerBuiltins } from '../services/terminal/builtins';

registerBuiltins();

const router = Router();

/**
 * Mounted behind the same `authenticate` middleware as every other /api route, so
 * `req.user` is an already-verified Appwrite user. There is deliberately no second
 * authentication path here (no socket handshake, no API key) — one door, the one
 * that is already tested.
 */
interface AuthedRequest extends Request {
    user?: { $id?: string; email?: string };
}

async function contextFor(req: AuthedRequest): Promise<TerminalContext> {
    const userId = req.user?.$id;
    if (!userId) {
        // Should be unreachable behind `authenticate`; treated as a fault, not a 401,
        // because reaching it means the mount point lost its middleware.
        throw new Error('terminal route reached without an authenticated user');
    }
    return {
        userId,
        email: req.user?.email ?? 'unknown',
        role: await resolveRole(userId),
    };
}

/** Verb table for the client, filtered to what this caller may actually run. */
router.get('/commands', async (req: AuthedRequest, res: Response) => {
    try {
        const ctx = await contextFor(req);
        res.json({
            role: ctx.role,
            commands: listCommands(ctx.role).map((c) => ({
                name: c.name,
                summary: c.summary,
                usage: c.usage,
            })),
        });
    } catch (err) {
        logger.error('[terminal] command list failed:', err);
        res.status(500).json({ error: 'Failed to list commands' });
    }
});

router.post('/exec', terminalLimiter, async (req: AuthedRequest, res: Response) => {
    const raw: unknown = req.body?.command;
    if (typeof raw !== 'string') {
        return res.status(400).json({ error: "Body must include a string 'command'" });
    }

    let ctx: TerminalContext;
    try {
        ctx = await contextFor(req);
    } catch (err) {
        // resolveRole throws rather than defaulting, so a ROLES outage lands here.
        // Fail closed: no role means no command runs.
        logger.error('[terminal] role resolution failed — refusing command:', err);
        return res.status(503).json({ error: 'Role verification unavailable — command refused' });
    }

    let outcome: 'ok' | 'rejected' | 'error' | 'refused_unauditable' = 'ok';
    let lines: readonly string[] = [];
    let status = 200;
    let errorMessage: string | undefined;
    // What actually ran, for the audit record. Falls back to the raw input only
    // when the verb never resolved (unknown command), where raw text is all there is.
    let verb: string | null = null;
    let argv: readonly string[] = [];
    let mutating = false;
    let alreadyAudited = false;

    try {
        const result = await dispatch(raw, ctx, async (command, resolvedArgs) => {
            verb = command.name;
            argv = resolvedArgs;
            mutating = command.mutating;

            // Fail-closed for state-changing verbs: the record is written before the
            // handler runs, and a failed write aborts the command. Auditing afterwards
            // cannot fail closed — the change would already have happened.
            if (command.mutating) {
                await writeAudit(ctx, command.name, resolvedArgs, true, 'started');
                alreadyAudited = true;
            }
        });
        lines = result.lines;
        verb = result.command;
        argv = result.argv;
        mutating = result.mutating;
    } catch (err) {
        if (err instanceof CommandError) {
            outcome = 'rejected';
            status = err.status;
            errorMessage = err.message;
            verb = err.verb ?? null;
        } else if (mutating && !alreadyAudited) {
            // The pre-execution audit write threw, so the handler never ran.
            outcome = 'refused_unauditable';
            status = 503;
            errorMessage = 'Audit ledger unavailable — mutating command refused';
            logger.error('[terminal] refused mutating command, ledger unavailable', {
                event: 'terminal_audit_unavailable', userId: ctx.userId, command: verb,
            });
        } else {
            outcome = 'error';
            status = 500;
            errorMessage = 'Command failed';
            logger.error('[terminal] handler fault:', err);
        }
    }

    // Read-only verbs are audited after the fact and tolerate a failed write; a
    // mutating verb that already wrote its 'started' record gets an outcome record
    // best-effort, since the intent is durably on the ledger either way.
    await recordAudit(ctx, verb, argv, mutating, outcome, verb === null ? raw : undefined);

    return status === 200
        ? res.json({ lines })
        : res.status(status).json({ error: errorMessage });
});

/** Raw input is only recorded when no verb resolved, and is bounded so the ledger can't be flooded. */
const RAW_ECHO_LIMIT = 512;

/**
 * Writes one entry to the tamper-evident ledger. Throws on failure — callers decide
 * whether that is fatal, which is what makes fail-closed possible for mutating verbs.
 *
 * `{ required: true }` is what makes that sentence true rather than aspirational.
 * Without it, logSecureAuditEvent catches everything internally and resolves, so this
 * function could not throw, `recordAudit`'s catch was unreachable, and a mutating
 * verb's "refuse if the write fails" path could never fire. The fatality decision
 * lives in the choice of wrapper — writeAudit propagates, recordAudit swallows — so
 * this call always asks to be told about failure and lets the caller judge it.
 */
async function writeAudit(
    ctx: TerminalContext,
    command: string | null,
    argv: readonly string[],
    mutating: boolean,
    outcome: string,
    rawFallback?: string,
): Promise<void> {
    await logSecureAuditEvent(
        ctx.userId,
        'TERMINAL_COMMAND',
        'system',
        JSON.stringify({
            command,
            argv,
            mutating,
            outcome,
            role: ctx.role,
            email: ctx.email,
            // Present only for input that never resolved to a verb; that raw text is
            // the whole forensic value of the record in that case.
            ...(rawFallback !== undefined ? { raw: rawFallback.slice(0, RAW_ECHO_LIMIT) } : {}),
        }),
        { required: true },
    );
}

/**
 * Best-effort audit for the paths where a failed write must not change the outcome:
 * read-only verbs, rejections, and the closing record of a mutating verb whose
 * 'started' entry is already durable.
 *
 * Fail-open here is deliberate and bounded — it can no longer silently cover a state
 * change, because a mutating verb is audited before it runs and refuses if that fails.
 */
async function recordAudit(
    ctx: TerminalContext,
    command: string | null,
    argv: readonly string[],
    mutating: boolean,
    outcome: string,
    rawFallback?: string,
): Promise<void> {
    try {
        await writeAudit(ctx, command, argv, mutating, outcome, rawFallback);
    } catch (err) {
        logger.error('[terminal] terminal_audit_degraded — command ran but was not recorded', {
            event: 'terminal_audit_degraded',
            userId: ctx.userId,
            command,
            mutating,
            outcome,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

export default router;
