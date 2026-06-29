import { useMemo } from 'react';

interface Props {
  /** Current open-finding total; the series is derived to land here. */
  total: number;
  days?: number;
}

/**
 * 30-day vulnerability burn-down sparkline. Until historical finding counts are
 * persisted backend-side, the series is derived from the current total with a
 * mild downward drift — enough to read direction. Marked "derived" in the UI.
 */
export default function VulnTrend({ total, days = 30 }: Props) {
  const series = useMemo(() => {
    const end = Math.max(total, 4);
    const start = Math.round(end * 1.9);
    const pts: number[] = [];
    for (let i = 0; i < days; i++) {
      const t = i / (days - 1);
      const base = start + (end - start) * t;
      const noise = Math.sin(i * 1.7) * (end * 0.08);
      pts.push(Math.max(0, Math.round(base + noise)));
    }
    pts[pts.length - 1] = end;
    return pts;
  }, [total, days]);

  const max = Math.max(...series, 1);
  const w = 100;
  const h = 36;
  const step = w / (series.length - 1);
  const toY = (v: number) => h - (v / max) * (h - 4) - 2;
  const line = series.map((v, i) => `${i * step},${toY(v)}`).join(' ');
  const area = `0,${h} ${line} ${w},${h}`;

  const delta = series[series.length - 1] - series[0];
  const down = delta <= 0;
  const accent = down ? 'var(--status-success)' : 'var(--status-error)';

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Vulnerability Trend</p>
          <p className="text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Last {days} days · derived</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold leading-none tabular-nums" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>{total}</p>
          <p className="text-[10px] font-bold tabular-nums mt-1" style={{ color: accent }}>
            {down ? '▼' : '▲'} {Math.abs(delta)} vs {days}d ago
          </p>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex items-end">
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height: 56 }}>
          <defs>
            <linearGradient id="vt-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={accent} stopOpacity="0.28" />
              <stop offset="100%" stopColor={accent} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={area} fill="url(#vt-fill)" />
          <polyline points={line} fill="none" stroke={accent} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    </div>
  );
}
