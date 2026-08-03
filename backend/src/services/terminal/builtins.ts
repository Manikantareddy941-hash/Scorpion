/**
 * Built-in Scorpion Terminal verbs.
 *
 * These need no service layer, so they are safe to register unconditionally at
 * module load. Domain verbs (gate status, provenance show, pipeline ls, ...) each
 * add one `register({...})` block here or in a sibling module, calling the existing
 * service layer so they inherit its RBAC and audit behaviour.
 *
 * Rule for anything added here: the handler calls a typed service function. It never
 * builds a shell string, never touches child_process, and never interpolates an
 * argument into a query. Arguments arrive as an already-split string[] and stay that way.
 */
import { register, listCommands, type TerminalCommand } from './commands';

const COLUMN_WIDTH = 18;

const help: TerminalCommand = {
    name: 'help',
    summary: 'List the commands available to you.',
    usage: 'help',
    maxArgs: 0,
    handler: async (_args, ctx) => {
        const available = listCommands(ctx.role);
        return [
            'Scorpion Terminal — audited command surface.',
            '',
            ...available.map((c) => `  ${c.usage.padEnd(COLUMN_WIDTH)}${c.summary}`),
            '',
            `${available.length} command(s) available to role '${ctx.role}'.`,
            'Every command you run is written to the tamper-evident audit ledger.',
        ];
    },
};

const whoami: TerminalCommand = {
    name: 'whoami',
    summary: 'Show the identity and role this session resolved to.',
    usage: 'whoami',
    maxArgs: 0,
    handler: async (_args, ctx) => [
        `user:  ${ctx.email}`,
        `id:    ${ctx.userId}`,
        `role:  ${ctx.role}`,
    ],
};

const version: TerminalCommand = {
    name: 'version',
    summary: 'Show backend version and runtime.',
    usage: 'version',
    maxArgs: 0,
    handler: async () => [
        `scorpion-backend ${process.env.npm_package_version ?? 'unknown'}`,
        `node ${process.version}`,
        `env  ${process.env.NODE_ENV ?? 'development'}`,
    ],
};

let registered = false;

/** Idempotent so tests can reset the registry and re-register without duplicate errors. */
export function registerBuiltins(): void {
    if (registered) return;
    [help, whoami, version].forEach(register);
    registered = true;
}

/** Test seam — pairs with __resetRegistryForTests(). */
export function __resetBuiltinsForTests(): void {
    registered = false;
}
