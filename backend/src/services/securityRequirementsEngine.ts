import {
  EmittedRequirement,
  GeneratedRequirement,
  ProjectProfile,
  ReconcilePlan,
  Severity,
  StoredRequirement,
} from '../types/securityRequirements.types';
import { securityRequirementRules } from './securityRequirementRules';

const SEVERITY_ORDER: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/**
 * Deterministically turn a project profile into a merged, sorted requirement
 * set. Pure — no I/O. The same profile always yields the same output, which is
 * what makes the engine unit-testable with exact assertions.
 */
export function generate(profile: ProjectProfile): GeneratedRequirement[] {
  const byCode = new Map<string, GeneratedRequirement>();

  for (const rule of securityRequirementRules) {
    if (!rule.when(profile)) continue;
    for (const emitted of rule.emit) mergeEmit(byCode, emitted, rule.id);
  }

  const result = [...byCode.values()];
  for (const req of result) {
    req.frameworks.sort();
    req.controlIds.sort();
    req.sourceRuleId.sort();
  }
  result.sort((a, b) => a.code.localeCompare(b.code));
  return result;
}

/**
 * Merge an emitted requirement into the accumulator by code. Multiple rules
 * (e.g. a PCI rule and a SOC 2 rule) legitimately emit the same baseline
 * requirement; we merge framework/control/source metadata rather than overwrite
 * so the requirement stays visible under every framework that produced it —
 * losing a framework tag would hide a satisfied requirement from that
 * framework's auditor.
 */
function mergeEmit(
  byCode: Map<string, GeneratedRequirement>,
  emitted: EmittedRequirement,
  ruleId: string,
): void {
  const current = byCode.get(emitted.code);
  if (!current) {
    byCode.set(emitted.code, {
      code: emitted.code,
      title: emitted.title,
      description: emitted.description,
      category: emitted.category,
      frameworks: [emitted.framework],
      controlIds: [emitted.controlId],
      severity: emitted.severity,
      status: emitted.status,
      remediation: emitted.remediation,
      sourceRuleId: [ruleId],
    });
    return;
  }

  if (!current.frameworks.includes(emitted.framework)) current.frameworks.push(emitted.framework);
  if (!current.controlIds.includes(emitted.controlId)) current.controlIds.push(emitted.controlId);
  if (!current.sourceRuleId.includes(ruleId)) current.sourceRuleId.push(ruleId);
  // Strongest wins: highest severity, and 'required' beats 'recommended'.
  if (SEVERITY_ORDER[emitted.severity] > SEVERITY_ORDER[current.severity]) current.severity = emitted.severity;
  if (emitted.status === 'required') current.status = 'required';
}

/**
 * Classify a freshly generated set against what is already stored for a project.
 * Keyed on the stable `code`: still-applicable requirements keep their stored
 * row (and its lifecycle/audit fields); new codes are created; stored codes no
 * longer generated become obsolete (never deleted — audit). Already-obsolete
 * rows are left alone.
 */
export function reconcile(
  generated: GeneratedRequirement[],
  stored: StoredRequirement[],
): ReconcilePlan {
  const generatedByCode = new Map(generated.map((g) => [g.code, g]));
  const storedByCode = new Map(stored.map((s) => [s.code, s]));

  const toCreate: GeneratedRequirement[] = [];
  const toUpdate: { stored: StoredRequirement; generated: GeneratedRequirement }[] = [];
  const toObsolete: StoredRequirement[] = [];

  for (const g of generated) {
    const existing = storedByCode.get(g.code);
    if (existing) toUpdate.push({ stored: existing, generated: g });
    else toCreate.push(g);
  }

  for (const s of stored) {
    if (!generatedByCode.has(s.code) && s.lifecycleStatus !== 'obsolete') toObsolete.push(s);
  }

  return { toCreate, toUpdate, toObsolete };
}
