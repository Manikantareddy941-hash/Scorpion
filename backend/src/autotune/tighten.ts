import { GateAction, GateRule } from '../repositories/gateRulesRepository';

/**
 * The safety kernel for auto-tune.
 *
 * v1 may only ever propose changes that make a gate STRICTER. This is not a
 * style preference — it removes an entire threat class. An engine that can
 * propose loosening a control is an engine an attacker wants to influence:
 * seed enough benign findings in the right phase and it argues, with evidence,
 * for turning a block into a warning. Tighten-only starves that incentive.
 *
 * The cost is real and accepted: controls ratchet one way. A relaxation has to
 * be hand-authored by a human through the normal gate-rules UI.
 *
 * Everything here is pure so the rule can be tested exhaustively and reused by
 * both the proposal engine and the apply path. The apply path MUST re-check —
 * a proposal row could have been written before this rule existed, or by a
 * future code path that forgot.
 */

/** The GateRule fields auto-tune is allowed to touch. */
export type TunableField = 'threshold' | 'action' | 'enabled';

export const TUNABLE_FIELDS: TunableField[] = ['threshold', 'action', 'enabled'];

export type TunableValue = number | GateAction | boolean;

/** Strictness order for `action`. A higher index blocks more. */
const ACTION_RANK: Record<GateAction, number> = { warn: 0, block: 1 };

export type TightenVerdict =
  | { tightening: true }
  | { tightening: false; reason: string };

/**
 * True only if moving `field` from `current` to `proposed` makes the gate
 * strictly stricter.
 *
 * - threshold: LOWER is stricter (fewer findings tolerated before the gate fires)
 * - action:    warn -> block only
 * - enabled:   false -> true only
 *
 * A no-op change is rejected rather than waved through: a proposal that changes
 * nothing still consumes a reviewer's attention and, once approved, writes an
 * audit record implying a control moved when it did not.
 */
export function isTightening(field: TunableField, current: TunableValue, proposed: TunableValue): TightenVerdict {
  if (current === proposed) return { tightening: false, reason: 'no change' };

  switch (field) {
    case 'threshold': {
      if (typeof current !== 'number' || typeof proposed !== 'number') {
        return { tightening: false, reason: 'threshold must be numeric' };
      }
      if (!Number.isFinite(proposed) || proposed < 0) {
        return { tightening: false, reason: 'threshold must be a non-negative finite number' };
      }
      return proposed < current
        ? { tightening: true }
        : { tightening: false, reason: `raising a threshold (${current} -> ${proposed}) tolerates more findings` };
    }

    case 'action': {
      const from = ACTION_RANK[current as GateAction];
      const to = ACTION_RANK[proposed as GateAction];
      if (from === undefined || to === undefined) {
        return { tightening: false, reason: 'action must be "warn" or "block"' };
      }
      return to > from
        ? { tightening: true }
        : { tightening: false, reason: `downgrading ${String(current)} -> ${String(proposed)} enforces less` };
    }

    case 'enabled': {
      if (typeof current !== 'boolean' || typeof proposed !== 'boolean') {
        return { tightening: false, reason: 'enabled must be boolean' };
      }
      return proposed
        ? { tightening: true }
        : { tightening: false, reason: 'disabling a rule removes the control entirely' };
    }

    default: {
      // Exhaustiveness: a new TunableField must be handled here explicitly
      // rather than defaulting to "allowed".
      const never: never = field;
      return { tightening: false, reason: `unknown field ${String(never)}` };
    }
  }
}

/**
 * Reads the current value of a tunable field off a rule, so callers do not
 * index into GateRule with a string and lose type safety.
 */
export function currentValue(rule: GateRule, field: TunableField): TunableValue {
  if (field === 'threshold') return rule.threshold;
  if (field === 'action') return rule.action;
  return rule.enabled;
}

/**
 * Whether a proposal may be applied to the rule as it stands NOW.
 *
 * Deliberately re-derives `current` from the live rule rather than trusting the
 * value recorded when the proposal was written. If someone hand-edited the rule
 * in the meantime, applying a stale diff could silently move the control
 * backwards — the exact thing tighten-only exists to prevent.
 */
export function canApply(rule: GateRule, field: TunableField, proposed: TunableValue): TightenVerdict {
  return isTightening(field, currentValue(rule, field), proposed);
}
