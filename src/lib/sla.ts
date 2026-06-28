// Standard remediation SLA windows by severity (hours). Single source of truth
// shared by the dashboard SLA card, RemediationPanel countdowns, and posture export.
export const SLA_HOURS: Record<string, number> = { critical: 24, high: 72, medium: 168, low: 720 };

// Hours remaining before this finding breaches its SLA (negative = already breached).
export function slaHoursLeft(createdAtIso: string, severity: string, now: number = Date.now()): number {
  const slaH = SLA_HOURS[String(severity).toLowerCase()] ?? 168;
  return (new Date(createdAtIso).getTime() + slaH * 3600_000 - now) / 3600_000;
}

// SLA deadline timestamp for a finding (createdAt + severity window).
export function slaDeadline(createdAtIso: string, severity: string): Date {
  const slaH = SLA_HOURS[String(severity).toLowerCase()] ?? 168;
  return new Date(new Date(createdAtIso).getTime() + slaH * 3600_000);
}

// Whole days a finding is past its SLA deadline (0 if still within window).
export function daysOverdue(createdAtIso: string, severity: string, now: number = Date.now()): number {
  const hoursLeft = slaHoursLeft(createdAtIso, severity, now);
  return hoursLeft >= 0 ? 0 : Math.floor(-hoursLeft / 24);
}
