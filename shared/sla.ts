// Remediation SLA windows by severity (hours).
//
// Lives in shared/ because BOTH sides evaluate it: the frontend renders
// countdowns and overdue badges, the backend computes SLA attainment for the
// feedback surface. Two copies of a threshold in two languages is how a system
// starts disagreeing with itself about whether something is overdue — the same
// split-brain that produced userId/user_id and two URL normalizers.
export const SLA_HOURS: Record<string, number> = { critical: 24, high: 72, medium: 168, low: 720 };

/** Bucket an unrecognised severity falls into. */
export const DEFAULT_SEVERITY = 'medium';

/** Fallback window for a severity we do not recognise. */
export const DEFAULT_SLA_HOURS = SLA_HOURS[DEFAULT_SEVERITY];

/** Canonical severity bucket, case-insensitive; unknown severities fall back
 *  rather than being dropped — a finding missing from a report is worse than
 *  one filed under a neighbouring severity. */
export function severityBucket(severity: string): string {
  const key = String(severity).toLowerCase();
  return key in SLA_HOURS ? key : DEFAULT_SEVERITY;
}

/** SLA window for a severity, case-insensitive, falling back rather than throwing. */
export function slaHoursFor(severity: string): number {
  return SLA_HOURS[String(severity).toLowerCase()] ?? DEFAULT_SLA_HOURS;
}

// Hours remaining before this finding breaches its SLA (negative = already breached).
export function slaHoursLeft(createdAtIso: string, severity: string, now: number = Date.now()): number {
  return (new Date(createdAtIso).getTime() + slaHoursFor(severity) * 3600_000 - now) / 3600_000;
}

// SLA deadline timestamp for a finding (createdAt + severity window).
export function slaDeadline(createdAtIso: string, severity: string): Date {
  return new Date(new Date(createdAtIso).getTime() + slaHoursFor(severity) * 3600_000);
}

// Whole days a finding is past its SLA deadline (0 if still within window).
export function daysOverdue(createdAtIso: string, severity: string, now: number = Date.now()): number {
  const hoursLeft = slaHoursLeft(createdAtIso, severity, now);
  return hoursLeft >= 0 ? 0 : Math.floor(-hoursLeft / 24);
}
