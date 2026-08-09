/**
 * A failed build step, carrying its transcript and the captured streams.
 *
 * THE BUG THIS REPLACES. `execWithLogs` used to rethrow `{ ...error, logs }`. A
 * spread copies only ENUMERABLE own properties, and V8 marks `message` and `stack`
 * non-enumerable — so both were silently discarded at the throw. Nothing failed
 * loudly; the build just reported a JSON blob instead of a reason, and the outer
 * handler grew a `JSON.stringify(error)` fallback to compensate for a message that
 * was already gone.
 *
 * A real Error subclass keeps `message` and `stack` because it is thrown by
 * reference, and `cause` retains the original rejection so `errorContext` can report
 * both halves of the chain.
 */
export class BuildCommandError extends Error {
    public readonly stdout?: string;
    public readonly stderr?: string;
    public readonly logs?: string;

    constructor(
        message: string,
        options: { stdout?: string; stderr?: string; logs?: string; cause?: unknown } = {},
    ) {
        super(message);
        this.name = 'BuildCommandError';
        this.stdout = options.stdout;
        this.stderr = options.stderr;
        this.logs = options.logs;

        // `cause` is ES2022 and this project compiles against es2016, so it is
        // assigned through a narrow type rather than passed to the two-argument
        // Error constructor, which does not typecheck here.
        if (options.cause !== undefined) {
            (this as Error & { cause?: unknown }).cause = options.cause;
        }
    }
}

/**
 * The build transcript attached to a thrown value, from either producer.
 *
 * Deliberately structural rather than `instanceof BuildCommandError`: the image
 * signing path rethrows `Object.assign(signErr, { logs })` on a CosignSigningError,
 * and an instanceof check would drop that transcript — the exact loss the comment on
 * that throw warns against.
 */
export function attachedLogs(error: unknown): string | undefined {
    if (!(error instanceof Error)) return undefined;
    const logs = (error as Error & { logs?: unknown }).logs;
    return typeof logs === 'string' ? logs : undefined;
}
