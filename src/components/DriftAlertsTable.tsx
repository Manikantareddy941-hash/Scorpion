import { AlertTriangle, ShieldOff } from 'lucide-react';
import { useDrift, type DriftRecord, type DriftSeverity, type DriftType } from '../hooks/useDrift';

const SEVERITY_COLOR: Record<DriftSeverity, string> = {
  critical: 'var(--severity-critical)',
  high: 'var(--severity-high)',
  medium: 'var(--severity-medium)',
  low: 'var(--severity-low)',
};

const DRIFT_TYPE_LABEL: Record<DriftType, string> = {
  'gate-violation': 'Gate Violation',
  'unscanned-image': 'Unscanned Image',
  'out-of-band-update': 'Out-of-Band Update',
};

function shortDigest(digest: string): string {
  if (!digest) return '—';
  return digest.length > 22 ? `${digest.slice(0, 22)}…` : digest;
}

function SeverityBadge({ severity }: { severity: DriftSeverity }) {
  const color = SEVERITY_COLOR[severity];
  return (
    <span
      className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
      style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
    >
      {severity}
    </span>
  );
}

function DriftRow({ record }: { record: DriftRecord }) {
  return (
    <tr className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
      <td className="px-3 py-2.5"><SeverityBadge severity={record.severity} /></td>
      <td className="px-3 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
        {DRIFT_TYPE_LABEL[record.driftType]}
      </td>
      <td className="px-3 py-2.5 font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{record.podName}</td>
      <td className="px-3 py-2.5 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{record.namespace}</td>
      <td className="px-3 py-2.5 font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }} title={record.imageDigest}>
        {shortDigest(record.imageDigest)}
      </td>
    </tr>
  );
}

/**
 * Runtime drift anomalies table. Self-contained container: consumes useDrift
 * and renders loading / error / empty / data states explicitly.
 */
export default function DriftAlertsTable() {
  const { records, loading, error } = useDrift();

  return (
    <div className="p-4 rounded-md border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--card-shadow)' }}>
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle size={14} style={{ color: 'var(--status-warning)' }} />
        <p className="text-[11px] font-semibold tracking-wider uppercase" style={{ color: 'var(--text-secondary)' }}>
          Runtime Drift Anomalies
        </p>
        {!loading && !error && (
          <span className="ml-auto text-[11px] font-bold tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {records.length} active
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-8 rounded animate-pulse" style={{ background: 'var(--bg-secondary)' }} />
          ))}
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 py-6 justify-center text-sm" style={{ color: 'var(--status-error)' }}>
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      ) : records.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8" style={{ color: 'var(--text-muted)' }}>
          <ShieldOff size={20} />
          <span className="text-sm">No active runtime drift detected</span>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                {['Severity', 'Drift Type', 'Pod', 'Namespace', 'Image Digest'].map((h) => (
                  <th key={h} className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <DriftRow key={record.id} record={record} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
