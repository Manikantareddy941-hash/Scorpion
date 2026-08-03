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

    let outcome: 'ok' | 'rejected' | 'error' = 'ok';
    let lines: readonly string[] = [];
    let status = 200;
    let errorMessage: string | undefined;

    try {
        const result = await dispatch(raw, ctx);
        lines = result.lines;
    } catch (err) {
        if (err instanceof CommandError) {
            outcome = 'rejected';
            status = err.status;
            errorMessage = err.message;
        } else {
            outcome = 'error';
            status = 500;
            errorMessage = 'Command failed';
            logger.error('[terminal] handler fault:', err);
        }
    }

    await recordAudit(ctx, raw, outcome);

    return status === 200
        ? res.json({ lines })
        : res.status(status).json({ error: errorMessage });
});

/**
 * Writes the command to the tamper-evident ledger — including rejected ones, which
 * are the interesting ones for an investigation.
 *
 * Fail-open with a loud structured log, matching the established pattern for the
 * degraded-read paths in this codebase. That is only defensible while every verb is
 * read-only. THE MOMENT A MUTATING VERB IS REGISTERED, this must become fail-closed:
 * an unlogged privileged action is exactly the property this surface exists to avoid.
 */
async function recordAudit(ctx: TerminalContext, command: string, outcome: string): Promise<void> {
    try {
        await logSecureAuditEvent(
            ctx.userId,
            'TERMINAL_COMMAND',
            'system',
            JSON.stringify({ command, outcome, role: ctx.role, email: ctx.email }),
        );
    } catch (err) {
        logger.error('[terminal] terminal_audit_degraded — command ran but was not recorded', {
            event: 'terminal_audit_degraded',
            userId: ctx.userId,
            command,
            outcome,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

export default router;
