import { GateRule } from '../repositories/gateRulesRepository';
import { TUNABLE_FIELDS, canApply, currentValue, isTightening } from './tighten';

const rule = (over: Partial<GateRule> = {}): GateRule => ({
  id: 'r1', severity: 'high', threshold: 5, action: 'warn', enabled: true, ...over,
});

describe('threshold', () => {
  test('lowering is tightening — fewer findings tolerated', () => {
    expect(isTightening('threshold', 5, 2)).toEqual({ tightening: true });
  });

  test('raising is refused, with a reason a reviewer can read', () => {
    const verdict = isTightening('threshold', 5, 20);
    expect(verdict.tightening).toBe(false);
    expect(verdict).toHaveProperty('reason', expect.stringContaining('tolerates more'));
  });

  test('zero is a legitimate target — block on any finding at all', () => {
    expect(isTightening('threshold', 1, 0)).toEqual({ tightening: true });
  });

  test('a negative threshold is refused rather than treated as stricter', () => {
    // Lower is stricter, so -1 would pass a naive comparison while meaning
    // nothing the gate can enforce.
    expect(isTightening('threshold', 5, -1).tightening).toBe(false);
  });

  test('NaN and Infinity are refused', () => {
    expect(isTightening('threshold', 5, NaN).tightening).toBe(false);
    expect(isTightening('threshold', 5, -Infinity).tightening).toBe(false);
  });

  test('a non-numeric proposal is refused', () => {
    expect(isTightening('threshold', 5, 'block').tightening).toBe(false);
  });
});

describe('action', () => {
  test('warn to block is tightening', () => {
    expect(isTightening('action', 'warn', 'block')).toEqual({ tightening: true });
  });

  test('block to warn is refused — this is the attacker-desirable direction', () => {
    const verdict = isTightening('action', 'block', 'warn');
    expect(verdict.tightening).toBe(false);
    expect(verdict).toHaveProperty('reason', expect.stringContaining('enforces less'));
  });

  test('an unrecognised action is refused rather than ranked as unknown', () => {
    expect(isTightening('action', 'warn', 'ignore' as never).tightening).toBe(false);
  });
});

describe('enabled', () => {
  test('turning a rule on is tightening', () => {
    expect(isTightening('enabled', false, true)).toEqual({ tightening: true });
  });

  test('turning a rule off is refused — it removes the control entirely', () => {
    expect(isTightening('enabled', true, false).tightening).toBe(false);
  });
});

test('a no-op is refused so it cannot consume review attention or forge an audit entry', () => {
  for (const [field, value] of [['threshold', 5], ['action', 'warn'], ['enabled', true]] as const) {
    expect(isTightening(field, value, value)).toEqual({ tightening: false, reason: 'no change' });
  }
});

test('every tunable field is handled — no field falls through to "allowed"', () => {
  // If a field is added to TUNABLE_FIELDS without a case, this catches it:
  // an unhandled field must never be permissive by default.
  for (const field of TUNABLE_FIELDS) {
    const verdict = isTightening(field, 'nonsense' as never, 'also nonsense' as never);
    expect(verdict.tightening).toBe(false);
  }
});

describe('canApply re-derives from the live rule', () => {
  test('permits a proposal that is still tightening against the current value', () => {
    expect(canApply(rule({ threshold: 5 }), 'threshold', 2)).toEqual({ tightening: true });
  });

  test('refuses when the rule was hand-tightened past the proposal in the meantime', () => {
    // Proposal said 5 -> 2. Someone has since set it to 1. Applying the stale
    // diff would move the control BACKWARDS, which is what tighten-only exists
    // to prevent — and why current is read from the rule, not the proposal.
    expect(canApply(rule({ threshold: 1 }), 'threshold', 2).tightening).toBe(false);
  });

  test('refuses when the rule already reached the proposed value', () => {
    expect(canApply(rule({ action: 'block' }), 'action', 'block')).toEqual({ tightening: false, reason: 'no change' });
  });
});

test('currentValue reads each field with its real type', () => {
  const r = rule({ threshold: 9, action: 'block', enabled: false });
  expect(currentValue(r, 'threshold')).toBe(9);
  expect(currentValue(r, 'action')).toBe('block');
  expect(currentValue(r, 'enabled')).toBe(false);
});
