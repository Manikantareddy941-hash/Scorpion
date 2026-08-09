/**
 * The error a failed build command throws.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * buildService.ts imports the scan pipeline, cosign, provenance, the image store
 * and ../lib/appwrite — which constructs an Appwrite Client at module load. A test
 * for a plain error class should not drag any of that in, so the class lives here
 * and both the service and its test import it from one small file with no side
 * effects.
 *
 * WHY IT REPLACES `throw { ...error, logs }`
 *
 * Spreading an Error produces an object without `message` or `stack`: V8 marks both
 * non-enumerable, so they are not copied. The old rethrow therefore destroyed the
 * reason for the failure, and the downstream handler's `JSON.stringify(error)`
 * fallback existed precisely to paper over it. Nothing errored; the build simply
 * reported a blob instead of a cause. Throwing a real Error by reference keeps
 * `message`, `stack`, `instanceof` and the cause chain intact.
 */
export class BuildCommandError extends Error {
    public readonly stdout?: string;
    public readonly stderr?: string;
    public readonly logs?: string;

    constructor(
        message: string,
        options: { stdout?: string; stderr?: string; logs?: string; cause?: unknown },
    ) {
        super(message);
        this.name = 'BuildCommandError';
        this.stdout = options.stdout;
        this.stderr = options.stderr;
        this.logs = options.logs;

        // `cause` is assigned rather than passed to super(message, { cause }).
        // The two-argument Error constructor is ES2022 and this project compiles
        // against es2016, so `ErrorOptions` is absent from the type and the call
        // fails with TS2554 — while the property works on every Node version this
        // ships to. Same narrow-type approach errorContext() uses to read it back.
        //
        // Assigned only when present, so `'cause' in err` stays false otherwise and
        // errorContext omits the key rather than logging `cause: undefined`.
        if (options.cause !== undefined) {
            (this as Error & { cause?: unknown }).cause = options.cause;
        }
    }
}
