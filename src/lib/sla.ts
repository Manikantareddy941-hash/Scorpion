// SLA windows and helpers now live in shared/sla.ts so the backend evaluates
// the same thresholds this UI renders. Two copies of a threshold in two
// languages is how a system starts disagreeing with itself about whether
// something is overdue.
//
// Re-exported here so existing importers (Dashboard, RemediationPanel, Issues,
// PostureExportButton) keep working unchanged.
export {
  SLA_HOURS,
  DEFAULT_SLA_HOURS,
  slaHoursFor,
  slaHoursLeft,
  slaDeadline,
  daysOverdue,
} from '../../shared/sla';
