type StatusKind = 'success' | 'error' | 'warning' | 'info' | 'neutral';

const STATUS_CLASSES: Record<StatusKind, string> = {
  success: 'bg-accent/10 text-accent border-accent/30',
  error: 'bg-severity-critical-bg text-severity-critical-fg border-severity-critical-border',
  warning: 'bg-severity-medium-bg text-severity-medium-fg border-severity-medium-border',
  info: 'bg-severity-low-bg text-severity-low-fg border-severity-low-border',
  neutral: 'bg-neutral-800 text-neutral-400 border-neutral-700',
};

const SUCCESS_VALUES = new Set([
  'success', 'completed', 'complete', 'passed', 'pass', 'resolved', 'verified',
  'connected', 'online', 'active', 'secure', 'allowed', 'remediated', 'fixed',
]);
const ERROR_VALUES = new Set([
  'error', 'failed', 'fail', 'blocked', 'offline', 'disconnected', 'denied', 'critical',
]);
const WARNING_VALUES = new Set(['warning', 'degraded', 'monitored', 'partial']);
const INFO_VALUES = new Set([
  'running', 'pending', 'in_progress', 'in-progress', 'queued', 'scanning', 'staging',
]);

export function normalizeStatus(raw?: string | null): StatusKind {
  const s = (raw || '').toLowerCase().trim();
  if (SUCCESS_VALUES.has(s)) return 'success';
  if (ERROR_VALUES.has(s)) return 'error';
  if (WARNING_VALUES.has(s)) return 'warning';
  if (INFO_VALUES.has(s)) return 'info';
  return 'neutral';
}

interface StatusBadgeProps {
  status?: string | null;
  label?: string;
  className?: string;
}

export default function StatusBadge({ status, label, className = '' }: StatusBadgeProps) {
  const kind = normalizeStatus(status);
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border whitespace-nowrap ${STATUS_CLASSES[kind]} ${className}`}
    >
      {label || status || kind}
    </span>
  );
}
