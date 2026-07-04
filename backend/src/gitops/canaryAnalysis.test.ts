import { evaluateCanaryCheck, nextCanaryState, CanaryProgress } from './canaryAnalysis';

const T = { maxErrorRatePct: 2 };
const TL = { maxErrorRatePct: 2, maxP95LatencyMs: 500 };

describe('evaluateCanaryCheck', () => {
  it('passes under the error-rate threshold', () => {
    const r = evaluateCanaryCheck({ errorRatePct: 0.4, p95LatencyMs: null }, T);
    expect(r.passed).toBe(true);
    expect(r.reason).toContain('0.4');
  });

  it('passes at exactly the threshold (boundary)', () => {
    expect(evaluateCanaryCheck({ errorRatePct: 2, p95LatencyMs: null }, T).passed).toBe(true);
  });

  it('fails above the error-rate threshold', () => {
    const r = evaluateCanaryCheck({ errorRatePct: 5.5, p95LatencyMs: null }, T);
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/error rate/i);
  });

  it('fails secure when the error-rate metric is unavailable', () => {
    const r = evaluateCanaryCheck({ errorRatePct: null, p95LatencyMs: 100 }, T);
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/unavailable/i);
  });

  it('ignores latency entirely when no latency threshold is set', () => {
    expect(evaluateCanaryCheck({ errorRatePct: 1, p95LatencyMs: null }, T).passed).toBe(true);
    expect(evaluateCanaryCheck({ errorRatePct: 1, p95LatencyMs: 99999 }, T).passed).toBe(true);
  });

  it('fails when latency threshold is set and p95 breaches it', () => {
    const r = evaluateCanaryCheck({ errorRatePct: 1, p95LatencyMs: 800 }, TL);
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/latency/i);
  });

  it('fails secure when latency threshold is set but the metric is unavailable', () => {
    expect(evaluateCanaryCheck({ errorRatePct: 1, p95LatencyMs: null }, TL).passed).toBe(false);
  });
});

describe('nextCanaryState', () => {
  const fresh: CanaryProgress = { consecutiveFailures: 0, passedChecks: 0 };
  const pass = { passed: true, reason: 'ok' };
  const fail = { passed: false, reason: 'bad' };

  it('a pass increments passedChecks and resets consecutiveFailures', () => {
    const { progress, verdict } = nextCanaryState({ consecutiveFailures: 2, passedChecks: 1 }, pass, 3, 5);
    expect(progress).toEqual({ consecutiveFailures: 0, passedChecks: 2 });
    expect(verdict).toBe('continue');
  });

  it('a fail increments consecutiveFailures and keeps passedChecks', () => {
    const { progress, verdict } = nextCanaryState({ consecutiveFailures: 0, passedChecks: 2 }, fail, 3, 5);
    expect(progress).toEqual({ consecutiveFailures: 1, passedChecks: 2 });
    expect(verdict).toBe('continue');
  });

  it('reaching maxFailures yields rollback', () => {
    expect(nextCanaryState({ consecutiveFailures: 2, passedChecks: 0 }, fail, 3, 5).verdict).toBe('rollback');
  });

  it('reaching requiredChecks yields promote', () => {
    expect(nextCanaryState({ consecutiveFailures: 0, passedChecks: 4 }, pass, 3, 5).verdict).toBe('promote');
  });

  it('interleaved fail/pass sequence recovers and promotes', () => {
    let p = fresh;
    const seq = [fail, pass, fail, pass, pass];
    let verdict = '';
    for (const c of seq) {
      const r = nextCanaryState(p, c, 3, 3);
      p = r.progress;
      verdict = r.verdict;
    }
    expect(verdict).toBe('promote');
    expect(p.passedChecks).toBe(3);
  });

  it('maxFailures 1 rolls back on the first failure', () => {
    expect(nextCanaryState(fresh, fail, 1, 5).verdict).toBe('rollback');
  });
});
