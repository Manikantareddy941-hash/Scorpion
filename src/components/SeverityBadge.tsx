type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

const SEVERITY_CLASSES: Record<Severity, string> = {
  critical: 'bg-severity-critical-bg text-severity-critical-fg border-severity-critical-border',
  high: 'bg-severity-high-bg text-severity-high-fg border-severity-high-border',
  medium: 'bg-severity-medium-bg text-severity-medium-fg border-severity-medium-border',
  low: 'bg-severity-low-bg text-severity-low-fg border-severity-low-border',
  info: 'bg-severity-info-bg text-severity-info-fg border-severity-info-border',
};

export function normalizeSeverity(raw?: string | null): Severity {
  const s = (raw || '').toLowerCase().trim();
  if (s.startsWith('crit')) return 'critical';
  if (s.startsWith('high')) return 'high';
  if (s.startsWith('med')) return 'medium';
  if (s.startsWith('low')) return 'low';
  return 'info';
}

interface SeverityBadgeProps {
  severity?: string | null;
  /** Override the displayed text (e.g. a translated label) while still coloring by `severity`. */
  label?: string;
  className?: string;
}

export default function SeverityBadge({ severity, label, className = '' }: SeverityBadgeProps) {
  const level = normalizeSeverity(severity);
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border whitespace-nowrap ${SEVERITY_CLASSES[level]} ${className}`}
    >
      {label || severity || level}
    </span>
  );
}
