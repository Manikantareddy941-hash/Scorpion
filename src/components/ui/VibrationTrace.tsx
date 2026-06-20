import React, { useMemo } from 'react';

interface VibrationTraceProps {
  /** 0 (dead calm) to 1 (heavy activity) — drives amplitude and scroll speed. */
  activity?: number;
  /** Punches a sharp spike into the trace in the critical color — true when criticals are open. */
  critical?: boolean;
  height?: number;
  className?: string;
}

const SEGMENT_WIDTH = 600;
const POINTS = 60;

function buildPath(activity: number, critical: boolean, height: number): string {
  const mid = height / 2;
  const amp = (mid - 3) * (0.12 + activity * 0.88);
  let d = `M 0 ${mid.toFixed(1)}`;
  for (let i = 1; i <= POINTS; i++) {
    const t = i / POINTS;
    const x = t * SEGMENT_WIDTH;
    let y = mid
      + Math.sin(t * Math.PI * 9) * amp * 0.35
      + Math.sin(t * Math.PI * 3.5 + 1.1) * amp * 0.65;
    if (critical && (i === 14 || i === 38)) {
      y -= amp * 1.5 * (i === 14 ? 1 : -0.8);
    }
    d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

/**
 * The dashboard's signature live signal: a scorpion senses danger through
 * vibration, not sight. This is SCORPION sensing the codebase the same way —
 * flat and calm when posture is clean, spiking the instant something lands.
 */
const VibrationTrace: React.FC<VibrationTraceProps> = ({ activity = 0.15, critical = false, height = 28, className = '' }) => {
  const path = useMemo(() => buildPath(activity, critical, height), [activity, critical, height]);
  const duration = Math.max(4, 14 - activity * 10);

  return (
    <svg
      className={`vibration-trace ${className}`}
      viewBox={`0 0 ${SEGMENT_WIDTH * 2} ${height}`}
      preserveAspectRatio="none"
      style={{ height }}
      aria-hidden="true"
    >
      <g style={{ animation: `vt-scroll ${duration}s linear infinite` }}>
        <path d={path} className={critical ? 'vt-spike' : ''} />
        <path d={path} transform={`translate(${SEGMENT_WIDTH}, 0)`} className={critical ? 'vt-spike' : ''} />
      </g>
      <style>{`
        @keyframes vt-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-${SEGMENT_WIDTH}px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .vibration-trace g { animation: none !important; }
        }
      `}</style>
    </svg>
  );
};

export default VibrationTrace;
