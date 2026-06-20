import React from 'react';
import { Severity, severityVar } from './types';

interface TrendInfo {
  value: number;
  direction: 'up' | 'down' | 'flat';
  /** Whether the direction is a good thing (e.g. "down" for vuln count). Affects color. */
  positive?: boolean;
}

interface StatCardProps {
  title: string;
  value?: string | number;
  icon?: React.ReactNode;
  trend?: TrendInfo;
  /** Tints the left border / icon chip using a severity color token. */
  accent?: Severity | 'primary';
  footer?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

const trendArrow: Record<TrendInfo['direction'], string> = {
  up: '↑',
  down: '↓',
  flat: '→',
};

const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  icon,
  trend,
  accent = 'primary',
  footer,
  children,
  className = '',
  onClick,
}) => {
  const accentColor = accent === 'primary' ? 'var(--accent-primary)' : severityVar(accent);
  const trendColor = trend
    ? trend.positive === false
      ? severityVar('critical')
      : trend.positive === true
        ? severityVar('low')
        : 'var(--text-secondary)'
    : undefined;

  return (
    <div
      onClick={onClick}
      className={`plate relative p-4 ${onClick ? 'cursor-pointer interactive' : ''} ${className}`}
      style={{ borderLeftColor: accentColor, borderLeftWidth: 2 }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="plate-eyebrow truncate">
            {title}
          </div>
          {value !== undefined && (
            <div className="mt-1.5 text-2xl font-bold text-[var(--text-primary)] leading-tight font-mono">
              {value}
            </div>
          )}
          {trend && (
            <div className="mt-1 text-xs font-medium flex items-center gap-1 font-mono" style={{ color: trendColor }}>
              <span>{trendArrow[trend.direction]}</span>
              <span>{trend.value}%</span>
            </div>
          )}
        </div>
        {icon && (
          <div
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center border"
            style={{ backgroundColor: `color-mix(in srgb, ${accentColor} 14%, transparent)`, color: accentColor, borderColor: `color-mix(in srgb, ${accentColor} 35%, transparent)` }}
          >
            {icon}
          </div>
        )}
      </div>

      {children && <div className="mt-3">{children}</div>}

      {footer && (
        <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] text-xs text-[var(--text-secondary)]">
          {footer}
        </div>
      )}
    </div>
  );
};

export default StatCard;
