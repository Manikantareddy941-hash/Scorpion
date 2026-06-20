import React, { useMemo } from 'react';
import { Severity, SEVERITY_LABELS, SEVERITY_ORDER, severityVar } from './types';

type SeverityCounts = Partial<Record<Severity, number>>;

interface SeverityBarProps {
  counts: SeverityCounts;
  /** Bar height in px. */
  height?: number;
  /** Render a legend with colored dots, labels and counts below the bar. */
  showLegend?: boolean;
  /** Optional heading rendered above the bar. */
  label?: string;
  className?: string;
}

const SeverityBar: React.FC<SeverityBarProps> = ({
  counts,
  height = 14,
  showLegend = true,
  label,
  className = '',
}) => {
  const total = useMemo(
    () => SEVERITY_ORDER.reduce((sum, sev) => sum + (counts[sev] ?? 0), 0),
    [counts]
  );

  return (
    <div className={className}>
      {label && (
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          {label}
        </div>
      )}
      <div
        className="w-full flex rounded-full overflow-hidden bg-[var(--bg-secondary)] border border-[var(--border-subtle)]"
        style={{ height }}
      >
        {total === 0 ? (
          <div className="w-full flex items-center justify-center text-[10px] text-[var(--text-secondary)]">
            No findings
          </div>
        ) : (
          SEVERITY_ORDER.map((sev) => {
            const count = counts[sev] ?? 0;
            if (count <= 0) return null;
            const pct = (count / total) * 100;
            return (
              <div
                key={sev}
                title={`${SEVERITY_LABELS[sev]}: ${count}`}
                className="h-full transition-all duration-300 first:rounded-l-full last:rounded-r-full"
                style={{ width: `${pct}%`, backgroundColor: severityVar(sev) }}
              />
            );
          })
        )}
      </div>
      {showLegend && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {SEVERITY_ORDER.filter((sev) => (counts[sev] ?? 0) > 0).map((sev) => (
            <div key={sev} className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: severityVar(sev) }}
              />
              <span className="font-medium text-[var(--text-primary)]">{counts[sev]}</span>
              <span>{SEVERITY_LABELS[sev]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SeverityBar;
