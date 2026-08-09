/**
 * Type guards for the caught values this backend actually receives.
 *
 * A `catch` binding is `unknown`, and the clauses these serve do not merely log the
 * error — they branch on it. `code === 409` decides whether a migration treats an
 * attribute as already-present or as a failure; `type` decides whether a collection
 * is missing or the request was malformed. Those are control-flow decisions, so the
 * narrowing has to be real rather than an `any` that silences the compiler and
 * checks nothing.
 *
 * Each guard requires at least one discriminating property to be present and of the
 * right type. That matters: a guard whose fields are all optional and whose body only
 * checks `typeof err === 'object'` returns true for `{}` and narrows nothing. Callers
 * still see optional fields afterwards, because an Appwrite error genuinely may carry
 * `code` without `type`.
 *
 * For HTTP errors use `axios.isAxiosError` directly — axios ships its own guard and
 * a hand-rolled one would drift from it.
 */

/**
 * Exported because spreading a caught value requires proving it is an object first:
 * `{ ...err }` does not compile against `unknown`. Note what a spread does and does
 * not carry — an Error's `message` and `stack` are non-enumerable, so `{ ...err }`
 * silently drops both.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/**
 * Appwrite SDK and REST errors. `code` is the HTTP-ish status (404 missing, 409
 * conflict); `type` is Appwrite's machine-readable reason ('collection_not_found').
 */
export interface AppwriteError {
    code?: number;
    type?: string;
    message?: string;
}

export function isAppwriteError(err: unknown): err is AppwriteError {
    return isRecord(err) && (typeof err.code === 'number' || typeof err.type === 'string');
}

/**
 * Rejections from `child_process.exec`, which attach the captured streams, plus the
 * `logs` transcript this codebase adds when re-throwing a failed build step.
 *
 * `logs` belongs here rather than in a guard of its own because it arrives on the
 * same value: buildService rethrows `{ ...error, logs }`, so the build transcript and
 * the exec streams are read from one object by the same handler.
 */
export interface ExecError {
    stdout?: string;
    stderr?: string;
    logs?: string;
    message?: string;
}

export function isExecError(err: unknown): err is ExecError {
    return isRecord(err)
        && (typeof err.stdout === 'string' || typeof err.stderr === 'string' || typeof err.logs === 'string');
}
