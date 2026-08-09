import { timingSafeEqual } from 'crypto';

/**
 * Constant-time comparison for shared secrets and API keys.
 *
 * WHY NOT `===`
 *
 * String equality short-circuits at the first differing byte, so the time it
 * takes to reject a wrong secret is proportional to how many leading bytes were
 * correct. That is measurable, and it turns guessing a secret from an
 * exponential search into a linear one. The margin is small relative to network
 * jitter, but the correct comparison costs nothing and this codebase already
 * had two copies of it.
 *
 * WHY `provided` IS `unknown`
 *
 * Every caller reads it off `req.headers[...]`, which Express types as
 * `string | string[] | undefined`. A duplicated header arrives as an array, and
 * narrowing here means that case is rejected rather than throwing inside
 * Buffer.from. `expected` stays `string` because callers guard the env var
 * first — the `if (!secret)` at each site is what makes the fail-closed intent
 * legible, and it must not be delegated to this function.
 */
export function secretMatches(provided: unknown, expected: string): boolean {
    if (typeof provided !== 'string') return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    // timingSafeEqual throws on length mismatch, so compare lengths first.
    // The length itself is not the secret.
    return a.length === b.length && timingSafeEqual(a, b);
}
