import React, { useMemo } from 'react';

export interface HeatmapDatum {
  /** ISO date string, e.g. "2026-06-19". */
  date: string;
  count: number;
}

interface HeatmapGridProps {
  data: HeatmapDatum[];
  /** Number of trailing days to render, ending today. */
  days?: number;
  cellSize?: number;
  label?: string;
  /** CSS color the intensity scale is built from. */
  color?: string;
  className?: string;
}

const toKey = (d: Date) => d.toISOString().slice(0, 10);

const HeatmapGrid: React.FC<HeatmapGridProps> = ({
  data,
  days = 30,
  cellSize = 12,
  label,
  color = 'var(--accent-primary)',
  className = '',
}) => {
  const { weeks, maxCount } = useMemo(() => {
    const countByDate = new Map(data.map((d) => [d.date, d.count]));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - (days - 1));
    // Align to the start of the week (Sunday) so columns read like GitHub's grid.
    start.setDate(start.getDate() - start.getDay());

    const totalDays = Math.round((today.getTime() - start.getTime()) / 86400000) + 1;
    const cells = Array.from({ length: totalDays }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const key = toKey(d);
      return { date: key, count: countByDate.get(key) ?? 0 };
    });

    const weeks = Array.from({ length: Math.ceil(cells.length / 7) }, (_, i) =>
      cells.slice(i * 7, i * 7 + 7)
    );

    const maxCount = Math.max(1, ...data.map((d) => d.count));
    return { weeks, maxCount };
  }, [data, days]);

  const intensityFor = (count: number) => {
    if (count <= 0) return 0;
    const ratio = count / maxCount;
    if (ratio > 0.75) return 4;
    if (ratio > 0.5) return 3;
    if (ratio > 0.25) return 2;
    return 1;
  };

  const opacityScale = [0.08, 0.3, 0.5, 0.7, 1];

  return (
    <div className={className}>
      {label && (
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          {label}
        </div>
      )}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {week.map((cell) => {
              const intensity = intensityFor(cell.count);
              return (
                <div
                  key={cell.date}
                  title={`${cell.date}: ${cell.count} scan${cell.count === 1 ? '' : 's'}`}
                  className="rounded-sm transition-all duration-300 border border-[var(--border-subtle)]"
                  style={{
                    width: cellSize,
                    height: cellSize,
                    backgroundColor:
                      intensity === 0
                        ? '#f3f4f6'
                        : `color-mix(in srgb, ${color} ${opacityScale[intensity] * 100}%, transparent)`,
                    borderColor: intensity === 0 ? '#e5e7eb' : 'transparent',
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

export default HeatmapGrid;
