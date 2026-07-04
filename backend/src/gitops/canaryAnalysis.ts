/**
 * Pure decision core for canary analysis (Flagger-style). The worker feeds it
 * one metric sample per tick; it answers pass/fail and continue/promote/rollback.
 * Fail-secure: a missing metric is a failed check — no data, no judgment.
 */

export interface CanaryThresholds {
  maxErrorRatePct: number;
  maxP95LatencyMs?: number;
}

export interface CanaryCheckInput {
  /** Percent of requests that were 5xx over the window. null = metric unavailable. */
  errorRatePct: number | null;
  /** p95 request latency in ms. null = metric unavailable. */
  p95LatencyMs: number | null;
}

export interface CanaryCheckResult {
  passed: boolean;
  reason: string;
}

export interface CanaryProgress {
  consecutiveFailures: number;
  passedChecks: number;
}

export type CanaryVerdict = 'continue' | 'promote' | 'rollback';

export function evaluateCanaryCheck(input: CanaryCheckInput, thresholds: CanaryThresholds): CanaryCheckResult {
  if (input.errorRatePct === null) {
    return { passed: false, reason: 'error-rate metric unavailable — fail-secure' };
  }
  if (input.errorRatePct > thresholds.maxErrorRatePct) {
    return { passed: false, reason: `error rate ${input.errorRatePct}% > ${thresholds.maxErrorRatePct}%` };
  }
  if (thresholds.maxP95LatencyMs !== undefined) {
    if (input.p95LatencyMs === null) {
      return { passed: false, reason: 'p95 latency metric unavailable — fail-secure' };
    }
    if (input.p95LatencyMs > thresholds.maxP95LatencyMs) {
      return { passed: false, reason: `p95 latency ${input.p95LatencyMs}ms > ${thresholds.maxP95LatencyMs}ms` };
    }
  }
  return { passed: true, reason: `error rate ${input.errorRatePct}% ≤ ${thresholds.maxErrorRatePct}%` };
}

export function nextCanaryState(
  prev: CanaryProgress,
  check: CanaryCheckResult,
  maxFailures: number,
  requiredChecks: number
): { progress: CanaryProgress; verdict: CanaryVerdict } {
  const progress: CanaryProgress = check.passed
    ? { consecutiveFailures: 0, passedChecks: prev.passedChecks + 1 }
    : { consecutiveFailures: prev.consecutiveFailures + 1, passedChecks: prev.passedChecks };

  // Rollback outranks promote: sustained failure must never be masked.
  if (progress.consecutiveFailures >= maxFailures) return { progress, verdict: 'rollback' };
  if (progress.passedChecks >= requiredChecks) return { progress, verdict: 'promote' };
  return { progress, verdict: 'continue' };
}
