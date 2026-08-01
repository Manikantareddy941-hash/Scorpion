import { severityBucket } from '../../../shared/sla';
import { FindingRecord, escapeByPhase, escapeRecommendations } from '../monitor/feedbackMetrics';
import { GateConfig, GateRule } from '../repositories/gateRulesRepository';
import { TunableField, TunableValue, currentValue, isTightening } from './tighten';

/**
 * The proposal engine.
 *
 * Deliberately fixed and boring. An adaptive threshold tuner on day one
 * produces a queue whose logic nobody can explain, and an unexplainable queue
 * is either rubber-stamped or abandoned — both of which fail the same way
 * auto-apply does, only quieter. Every number here is a named constant meant to
 * be tuned by hand after watching real output.
 *
 * Pure: no I/O, no clock of its own. The caller supplies the findings, the
 * current gate config, the open proposals to dedupe against, and `now`.
 */

/** Rolling window over which escapes are counted. */
export const WINDOW_DAYS = 30;

/** Below this many findings in the window, a percentage is coincidence wearing a suit. */
export const MIN_SAMPLE = 10;

/** A phase must account for at least this share of escapes to be worth acting on. */
export const MIN_PHASE_SHARE = 0.4;

const MS_PER_DAY = 86_400_000;

/** Highest first, for breaking a tie between equally common severities. */
const SEVERITY_RANK = ['critical', 'high', 'medium', 'low'];

export interface ProposalDraft {
  targetKind: 'gate_rule';
  targetId: string;
  field: TunableField;
  currentValue: TunableValue;
  proposedValue: TunableValue;
  rationale: string;
  /** Identifies WHAT was measured, so approval can recompute exactly this. */
  metricKey: string;
  /** The value at proposal time. */
  metricValue: number;
  /** The value it had to cross. Approval refuses if it no longer does. */
  metricThreshold: number;
  /** Re-runnable descriptor — not a hash. See the migration for why. */
  evidenceQuery: string;
  sampleSize: number;
}

/**
 * Why a candidate produced no proposal.
 *
 * Returned rather than swallowed: a run that proposes nothing is the expected
 * outcome on a healthy pipeline, and an operator needs to tell that apart from
 * an engine that is silently broken.
 */
export interface SkipReason {
  reason: 'below_sample' | 'below_share' | 'no_rule_for_severity' | 'at_floor'
        | 'already_proposed' | 'not_tightening';
  detail: string;
}

export interface ProposalRun {
  proposals: ProposalDraft[];
  skipped: SkipReason[];
}

export interface ProposeOptions {
  now?: number;
  /** Open proposals, so the same rule+field is not queued twice. */
  existingOpen?: { targetId: string; field: string }[];
}

/** The severity that dominates a set of findings; ties break toward the more severe. */
function dominantSeverity(findings: FindingRecord[]): string {
  const counts = new Map<string, number>();
  for (const f of findings) {
    const bucket = severityBucket(f.severity);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  let best = '';
  let bestCount = -1;
  for (const severity of SEVERITY_RANK) {
    const count = counts.get(severity) ?? 0;
    if (count > bestCount) { best = severity; bestCount = count; }
  }
  return bestCount > 0 ? best : '';
}

/**
 * Picks the single change to propose for a rule.
 *
 * A disabled rule is not tightened by lowering its threshold — the threshold is
 * inert while the rule is off, so the change that actually restores the control
 * is switching it on. Only once it is on does the threshold mean anything.
 */
function draftFor(rule: GateRule): { field: TunableField; proposed: TunableValue } | null {
  if (!rule.enabled) return { field: 'enabled', proposed: true };
  // Already at the strictest possible setting: block on the first finding.
  // Correct behaviour, not a failure — DEFAULT_CONFIG seeds critical at 0, so
  // a fresh install legitimately has nothing to propose there.
  if (rule.threshold <= 0) return null;
  return { field: 'threshold', proposed: rule.threshold - 1 };
}

/**
 * Turns the escape-by-phase distribution into gate-rule proposals.
 *
 * The bridge that makes this non-obvious: escapes are counted by PHASE, while
 * gate rules are keyed by SEVERITY. The phase says where the pipeline leaks;
 * the severity of the findings leaking there says which rule governs them. So a
 * leaking phase is resolved to its dominant severity, and that severity's rule
 * is what gets proposed against.
 */
export function proposeFromEscapes(
  findings: FindingRecord[],
  config: GateConfig,
  opts: ProposeOptions = {},
): ProposalRun {
  const now = opts.now ?? Date.now();
  const since = now - WINDOW_DAYS * MS_PER_DAY;
  const existing = new Set((opts.existingOpen ?? []).map((p) => `${p.targetId}:${p.field}`));
  const skipped: SkipReason[] = [];

  const inWindow = findings.filter((f) => f.createdAt >= since && f.createdAt <= now);
  if (inWindow.length < MIN_SAMPLE) {
    skipped.push({
      reason: 'below_sample',
      detail: `${inWindow.length} findings in the last ${WINDOW_DAYS} days, need ${MIN_SAMPLE}`,
    });
    return { proposals: [], skipped };
  }

  const byPhase = escapeByPhase(inWindow);
  const ranked = escapeRecommendations(byPhase);
  const total = ranked.reduce((sum, p) => sum + p.count, 0);
  const proposals: ProposalDraft[] = [];

  for (const phase of ranked) {
    if (phase.share < MIN_PHASE_SHARE) {
      skipped.push({
        reason: 'below_share',
        detail: `${phase.phase}: ${(phase.share * 100).toFixed(0)}% of escapes, need ${MIN_PHASE_SHARE * 100}%`,
      });
      continue;
    }

    const phaseFindings = inWindow.filter((f) => escapeByPhase([f])[0]?.phase === phase.phase);
    const severity = dominantSeverity(phaseFindings);
    const rule = config.rules.find((r) => r.severity === severity);
    if (!rule) {
      skipped.push({
        reason: 'no_rule_for_severity',
        detail: `${phase.phase} leaks mostly ${severity || 'unknown'} findings, but no gate rule covers that severity`,
      });
      continue;
    }

    const draft = draftFor(rule);
    if (!draft) {
      skipped.push({
        reason: 'at_floor',
        detail: `${rule.severity} rule "${rule.id}" is already at threshold 0 — nothing stricter to propose`,
      });
      continue;
    }

    if (existing.has(`${rule.id}:${draft.field}`)) {
      skipped.push({ reason: 'already_proposed', detail: `${rule.id}.${draft.field} already has an open proposal` });
      continue;
    }

    const from = currentValue(rule, draft.field);
    const verdict = isTightening(draft.field, from, draft.proposed);
    if (!verdict.tightening) {
      // Belt and braces. The kernel is the authority even against this engine.
      skipped.push({ reason: 'not_tightening', detail: `${rule.id}.${draft.field}: ${verdict.reason}` });
      continue;
    }

    proposals.push({
      targetKind: 'gate_rule',
      targetId: rule.id,
      field: draft.field,
      currentValue: from,
      proposedValue: draft.proposed,
      rationale:
        `${(phase.share * 100).toFixed(0)}% of escaped findings in the last ${WINDOW_DAYS} days ` +
        `surfaced at the ${phase.phase} phase (${phase.count} of ${total}), mostly ${severity} severity. ` +
        `${phase.recommendation} ` +
        `Proposed: ${rule.severity} gate ${draft.field} ${String(from)} -> ${String(draft.proposed)}.`,
      metricKey: `escape_share:${phase.phase}`,
      metricValue: phase.share,
      metricThreshold: MIN_PHASE_SHARE,
      evidenceQuery: JSON.stringify({
        kind: 'escape_share',
        phase: phase.phase,
        windowDays: WINDOW_DAYS,
        minSample: MIN_SAMPLE,
      }),
      sampleSize: inWindow.length,
    });
  }

  return { proposals, skipped };
}
