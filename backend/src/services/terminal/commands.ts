/**
 * Scorpion Terminal — command registry and dispatcher.
 *
 * SECURITY MODEL, stated plainly because the whole feature rests on it:
 * no string the caller sends is ever executed. Input is tokenised and the first
 * token is looked up in a fixed Map. A miss is an error, never a fallthrough to
 * a shell, an eval, or a child process. There is no code path from user input to
 * execution — arbitrary command execution is not "blocked" here, it is absent.
 *
 * That property is what lets this surface exist at all on a control plane that
 * holds signing keys and gate state. Do not add a `default:` branch, a passthrough
 * verb, or a handler that shells out. If a future verb genuinely needs a sandbox,
 * it belongs in a disposable container behind its own review, not here.
 *
 * Every handler runs through the service layer, so commands inherit the existing
 * RBAC and the hash-chained audit ledger. That is the point: a verb that overrides
 * a gate writes the break-glass record, whereas a shell doing the same write does not.
 */

/** Max accepted input. Long enough for any real command, short enough to bound parsing. */
const MAX_INPUT_LENGTH = 512;

/** Max tokens after splitting. Guards against pathological whitespace input. */
const MAX_TOKENS = 32;

/** How much of a rejected command we echo back. Bounded so errors can't be used to reflect bulk text. */
const ECHO_LIMIT = 64;

export interface TerminalContext {
    userId: string;
    email: string;
    /** Resolved via the ROLES collection; 'user' when the caller has no role document. */
    role: string;
}

export interface TerminalCommand {
    name: string;
    summary: string;
    usage: string;
    /**
     * Whether this verb changes state. REQUIRED — deliberately not optional.
     *
     * This is the switch the audit path reads, not documentation. A mutating verb
     * has its audit record written BEFORE the handler runs, and refuses to run at
     * all if that write fails; a read-only verb is audited afterwards and tolerates
     * a failed write. Making the field required means a new verb cannot be
     * registered without its author deciding which side it is on — the compiler
     * asks the question that a comment previously only hinted at.
     */
    mutating: boolean;
    /** Roles permitted to run this verb. Omitted means any authenticated caller. */
    allowedRoles?: readonly string[];
    /**
     * Max positional arguments. Omitted means unbounded.
     *
     * Set this even on verbs that ignore their arguments. Without it, `help | sh`
     * runs help with '|' and 'sh' as inert args and prints a successful-looking
     * result — nothing executed, but on a security surface that reads as though the
     * pipe worked. Rejecting the extra tokens makes the refusal legible.
     */
    maxArgs?: number;
    handler: (args: readonly string[], ctx: TerminalContext) => Promise<readonly string[]>;
}

/** Thrown for anything the caller did wrong. Carries an HTTP-ish status for the route to map. */
export class CommandError extends Error {
    constructor(
        message: string,
        readonly status: 400 | 403 | 404 = 400,
        /**
         * The verb, when the failure happened after it resolved (role denial,
         * too many arguments). Absent for an unknown verb, where there is nothing
         * to name. Lets the audit record a resolved verb rather than raw input
         * wherever one exists.
         */
        readonly verb?: string,
    ) {
        super(message);
        this.name = 'CommandError';
    }
}

const registry = new Map<string, TerminalCommand>();

export function register(command: TerminalCommand): void {
    if (registry.has(command.name)) {
        // A duplicate registration means two features silently disagree about a verb.
        // Fail at module load rather than letting whichever imported last win.
        throw new Error(`[terminal] duplicate command registration: ${command.name}`);
    }
    registry.set(command.name, command);
}

/** Commands the given role may run. Drives both `help` and the UI's command list. */
export function listCommands(role: string): readonly TerminalCommand[] {
    return [...registry.values()]
        .filter((c) => canRun(c, role))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function canRun(command: TerminalCommand, role: string): boolean {
    return !command.allowedRoles || command.allowedRoles.includes(role);
}

/**
 * Rejects control characters and escape sequences before anything else looks at the
 * input. The frontend renders output as plain text nodes, but this surface is also
 * reachable by API clients and the audit ledger stores the raw command — neither
 * should ever receive a terminal escape sequence.
 */
function assertPrintable(input: string): void {
    for (const ch of input) {
        const code = ch.codePointAt(0) ?? 0;
        if (code < 0x20 || code === 0x7f) {
            throw new CommandError('command contains control characters');
        }
    }
}

export function tokenize(input: string): readonly string[] {
    return input.trim().split(/\s+/).filter((t) => t.length > 0);
}

export interface DispatchResult {
    /** Lines to print. Plain text — the client renders these as text nodes, never as HTML. */
    lines: readonly string[];
    /** The resolved verb, or null for blank input. Used for the audit record. */
    command: string | null;
    /**
     * Arguments as the handler received them, already tokenised. The audit records
     * these rather than the raw input string: raw text can differ from what actually
     * executed (whitespace, rejected trailing tokens), and an investigation needs to
     * know what ran, not what was typed.
     */
    argv: readonly string[];
    /** Copied from the resolved command so callers need not re-look-it-up. */
    mutating: boolean;
}

/**
 * Parse, authorise, and run. Throws CommandError for caller mistakes; anything else
 * propagating out is a genuine fault and the route maps it to a 500.
 */
export async function dispatch(
    rawInput: string,
    ctx: TerminalContext,
    /**
     * Called after the verb resolves and passes authorisation, but BEFORE the
     * handler runs. Throwing from here prevents execution entirely.
     *
     * This exists so the caller can write a mutating verb's audit record first and
     * abort if that write fails. Auditing after the fact cannot fail closed: by then
     * the state change has already happened and no error response un-does it.
     */
    beforeRun?: (command: TerminalCommand, argv: readonly string[]) => Promise<void>,
): Promise<DispatchResult> {
    if (rawInput.length > MAX_INPUT_LENGTH) {
        throw new CommandError(`command too long (max ${MAX_INPUT_LENGTH} characters)`);
    }
    assertPrintable(rawInput);

    const tokens = tokenize(rawInput);
    if (tokens.length === 0) {
        return { lines: [], command: null, argv: [], mutating: false };
    }
    if (tokens.length > MAX_TOKENS) {
        throw new CommandError(`too many arguments (max ${MAX_TOKENS})`);
    }

    const [verb, ...args] = tokens;
    const command = registry.get(verb);

    // The lookup IS the security boundary. A miss stops here.
    if (!command) {
        throw new CommandError(`unknown command '${verb.slice(0, ECHO_LIMIT)}' — try 'help'`, 404);
    }

    // Report an unauthorised known verb as forbidden rather than unknown. Hiding it
    // would leak nothing useful (`help` already lists only what you may run) and
    // would make a legitimate operator think the platform was broken.
    if (!canRun(command, ctx.role)) {
        throw new CommandError(
            `'${command.name}' requires role ${command.allowedRoles?.join(' or ')} — you have '${ctx.role}'`,
            403,
            command.name,
        );
    }

    if (command.maxArgs !== undefined && args.length > command.maxArgs) {
        throw new CommandError(
            command.maxArgs === 0
                ? `'${command.name}' takes no arguments — got ${args.length}`
                : `'${command.name}' takes at most ${command.maxArgs} argument(s) — got ${args.length}`,
            400,
            command.name,
        );
    }

    await beforeRun?.(command, args);

    const lines = await command.handler(args, ctx);
    return { lines, command: command.name, argv: args, mutating: command.mutating };
}

/** Test seam only. Production registration happens once at module load in ./builtins. */
export function __resetRegistryForTests(): void {
    registry.clear();
}
