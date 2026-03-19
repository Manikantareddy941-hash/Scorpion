import { Package, Wrench, ChevronDown, ChevronUp, Zap } from 'lucide-react';
import { useState } from 'react';
import type { AppwriteFinding } from '../pages/ScanResults';

const SEVERITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  CRITICAL: { bg: 'rgba(239,68,68,0.08)',   text: '#ef4444', border: 'rgba(239,68,68,0.25)' },
  HIGH:     { bg: 'rgba(249,115,22,0.08)',  text: '#f97316', border: 'rgba(249,115,22,0.25)' },
  MEDIUM:   { bg: 'rgba(234,179,8,0.08)',   text: '#eab308', border: 'rgba(234,179,8,0.25)'  },
  LOW:      { bg: 'rgba(148,163,184,0.08)', text: '#94a3b8', border: 'rgba(148,163,184,0.25)' },
};

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

interface Props {
  findings: AppwriteFinding[];
}

export default function FindingsTable({ findings }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(SEVERITY_ORDER));

  if (findings.length === 0) {
    return (
      <div className="p-20 text-center flex flex-col items-center justify-center">
        <div className="bg-[var(--bg-secondary)] w-20 h-20 rounded-3xl flex items-center justify-center mb-6 border border-[var(--border-subtle)]">
          <Zap className="w-10 h-10 text-[var(--text-secondary)] opacity-30" />
        </div>
        <p className="text-[var(--text-secondary)] font-black uppercase tracking-[0.2em] text-xs italic">No active threats detected. Clean scan.</p>
      </div>
    );
  }

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleGroup = (sev: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      next.has(sev) ? next.delete(sev) : next.add(sev);
      return next;
    });
  };

  // Group by severity in the defined order
  const grouped: Record<string, AppwriteFinding[]> = {};
  for (const sev of SEVERITY_ORDER) {
    const group = findings.filter(f => f.severity.toUpperCase() === sev);
    if (group.length > 0) grouped[sev] = group;
  }

  return (
    <div className="divide-y divide-[var(--border-subtle)]">
      {Object.entries(grouped).map(([sev, items]) => {
        const colors = SEVERITY_COLORS[sev] || SEVERITY_COLORS.LOW;
        const isOpen = openGroups.has(sev);
        return (
          <div key={sev}>
            {/* Severity group header */}
            <button
              onClick={() => toggleGroup(sev)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px', background: colors.bg, borderLeft: `4px solid ${colors.text}`, cursor: 'pointer' }}
            >
              <span style={{ color: colors.text, fontWeight: 800, fontSize: '0.72rem', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                {sev} &nbsp;·&nbsp; {items.length} {items.length === 1 ? 'finding' : 'findings'}
              </span>
              {isOpen ? <ChevronUp size={14} color={colors.text} /> : <ChevronDown size={14} color={colors.text} />}
            </button>

            {/* Findings in this group */}
            {isOpen && items.map(finding => {
              const isExpanded = expanded.has(finding.$id);
              return (
                <div
                  key={finding.$id}
                  style={{ borderLeft: `4px solid ${colors.border}`, padding: '0', transition: 'background 0.15s' }}
                  className="hover:bg-[var(--text-primary)]/5"
                >
                  {/* Row */}
                  <button
                    onClick={() => toggleExpand(finding.$id)}
                    style={{ width: '100%', textAlign: 'left', padding: '16px 24px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Title */}
                      <p style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.88rem', marginBottom: '6px', lineHeight: 1.4 }}>
                        {finding.title}
                      </p>
                      {/* Package + version pill row */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                        {finding.type === 'policy_violation' ? (
                          <span style={{ fontSize: '0.7rem', color: '#c084fc', background: 'rgba(192,132,252,0.08)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(192,132,252,0.25)', fontWeight: 800, letterSpacing: '0.05em' }}>
                            POLICY VIOLATION
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.7rem', color: '#60a5fa', background: 'rgba(96,165,250,0.08)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(96,165,250,0.25)', fontWeight: 800, letterSpacing: '0.05em' }}>
                            VULNERABILITY
                          </span>
                        )}
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                          <Package size={12} /> {finding.package}
                        </span>
                        
                        {finding.type !== 'policy_violation' && (
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', background: 'var(--bg-secondary)', padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                            installed: {finding.installedVersion}
                          </span>
                        )}
                        {finding.type !== 'policy_violation' && finding.fixedVersion && (
                          <span style={{ fontSize: '0.7rem', color: '#4ade80', background: 'rgba(74,222,128,0.08)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(74,222,128,0.2)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Wrench size={10} /> fix: {finding.fixedVersion}
                          </span>
                        )}
                        {finding.type !== 'policy_violation' && !finding.fixedVersion && (
                          <span style={{ fontSize: '0.7rem', color: '#94a3b8', background: 'rgba(148,163,184,0.08)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(148,163,184,0.2)' }}>
                            no fix available
                          </span>
                        )}
                      </div>
                    </div>
                    {isExpanded
                      ? <ChevronUp size={16} color="var(--text-secondary)" style={{ flexShrink: 0, marginTop: '2px' }} />
                      : <ChevronDown size={16} color="var(--text-secondary)" style={{ flexShrink: 0, marginTop: '2px' }} />
                    }
                  </button>

                  {/* Expanded description */}
                  {isExpanded && finding.description && (
                    <div style={{ padding: '0 24px 18px 24px' }}>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6, background: 'var(--bg-primary)', padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--border-subtle)', whiteSpace: 'pre-wrap' }}>
                        {finding.description}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
