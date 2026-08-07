import winston from 'winston';
import LokiTransport from 'winston-loki';

const isProduction = process.env.NODE_ENV === 'production';
const lokiEnabled = !!process.env.LOKI_URL && isProduction;

// Production logs to stdout as JSON so the cluster's log pipeline can parse them;
// local dev gets human-readable pretty output.
const consoleFormat = isProduction
  ? winston.format.json()
  : winston.format.prettyPrint();

/**
 * The fields every failure log carries. Nothing else from the error is emitted —
 * see errorContext for why that restriction is load-bearing.
 */
export interface ErrorContext {
    error: string;
    cause?: string;
    stack?: string;
}

/**
 * Normalises a caught value into the structured failure payload.
 *
 * THIS EXISTS BECAUSE OF A SILENT BUG. This logger is composed with
 * `winston.format.json()` and no `winston.format.splat()`, so a trailing *string*
 * argument is parked on `Symbol(splat)` and never serialised:
 *
 *     logger.error('msg', err.message)  ->  {"level":"error","message":"msg"}
 *     logger.error('msg', { error })    ->  {"level":"error","message":"msg","error":"boom"}
 *
 * Every failure log in this codebase used the first form. The line reached stdout
 * as a prefix ending in a colon, with the cause removed — which reads as a logged
 * failure while carrying none of the information a responder needs.
 *
 * (An `Error` *instance* as the second argument does survive; winston special-cases
 * it. Only the `.message` / `String(err)` form is swallowed.)
 *
 * WHAT IS DELIBERATELY NOT INCLUDED: the error object itself, and any of its
 * transport-specific properties. An axios rejection carries `err.config` — which
 * holds the Slack/Discord webhook URL (the token is in the path) and the
 * `Authorization: GenieKey ...` header. Spreading a caught error into a log payload
 * would publish those to stdout and to Loki. Only message, cause and stack cross
 * this boundary, and each is reduced to a string here rather than passed through.
 *
 * Callers add their own domain fields alongside; this owns only the error shape.
 */
/**
 * The message of a caught value, whatever it turned out to be.
 *
 * A `catch` binding is `unknown`, and `throw 'string'` / `Promise.reject(undefined)`
 * both reach these blocks through third-party libraries. This is the single narrowing
 * step for the string form, so call sites that only want text — an interpolated log
 * line, a rethrown message, a `last_error` column — do not each hand-roll
 * `x instanceof Error ? x.message : String(x)` and get it subtly different.
 *
 * Use errorContext instead when the destination is a structured log payload.
 */
export function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

export function errorContext(err: unknown): ErrorContext {
    if (!(err instanceof Error)) {
        return { error: errorMessage(err) };
    }
    // `Error.cause` is ES2022 and this project compiles against es2016, so the field
    // is absent from the `Error` type while being present at runtime on every
    // supported Node version. Read through a narrow type rather than widening the
    // whole backend's compile target for one property.
    const cause = (err as Error & { cause?: unknown }).cause;
    return {
        error: err.message,
        // Very often an Error. JSON.stringify of an Error is `{}` — message and stack
        // are non-enumerable — so an un-reduced cause would log as an empty object
        // and read as "no cause was recorded".
        ...(cause !== undefined ? { cause: describeCause(cause) } : {}),
        // Stacks name filesystem paths and internal module layout, so they stay out
        // of production logs. Read at call time, not module load: NODE_ENV is set
        // per-process and tests change it after import.
        ...(process.env.NODE_ENV !== 'production' && err.stack ? { stack: err.stack } : {}),
    };
}

function describeCause(cause: unknown): string {
    if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
    if (typeof cause === 'string') return cause;
    try {
        // Circular structures throw; a cause is not worth failing a log line over.
        return JSON.stringify(cause) ?? String(cause);
    } catch {
        return String(cause);
    }
}

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: consoleFormat
    }),
    ...(lokiEnabled ? [
      new LokiTransport({
        host: process.env.LOKI_URL!,
        labels: { 
          app: 'scorpion', 
          env: process.env.NODE_ENV || 'development' 
        },
        json: true,
        format: winston.format.json(),
        replaceTimestamp: true,
        onConnectionError: (err: any) => {
          if (process.env.NODE_ENV !== 'production') return; // silent in dev
          console.error('[Loki] Connection error:', err.message);
        }
      }) as winston.transport
    ] : [])
  ]
});
