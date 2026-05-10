import { Package, Wrench, ChevronDown, ChevronUp, Zap } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppwriteFinding } from '../pages/ScanResults';

const SEVERITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  CRITICAL: { bg: 'rgba(229,115,115,0.08)', text: 'var(--status-error)',   border: 'var(--status-error)'   },
  HIGH:     { bg: 'rgba(255,138,128,0.08)', text: 'var(--severity-high)',  border: 'var(--severity-high)'  },
  MEDIUM:   { bg: 'rgba(255,183,77,0.08)',  text: 'var(--status-warning)', border: 'var(--status-warning)' },
  LOW:      { bg: 'rgba(123,198,126,0.08)', text: 'var(--status-success)', border: 'var(--status-success)' },
};

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

interface Props {
  findings: AppwriteFinding[];
  onRemediate?: (id: string) => void;
}

export default function FindingsTable({ findings, onRemediate }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(SEVERITY_ORDER));

  if (findings.length === 0) {
    return (
      <div className="p-20 text-center flex flex-col items-center justify-center">
        <div className="bg-[var(--bg-secondary)] w-20 h-20 rounded-3xl flex items-center justify-center mb-6 border border-[var(--border-subtle)]">
          <Zap className="w-10 h-10 text-[var(--text-secondary)] opacity-30" />
        </div>
        <p className="text-[var(--text-secondary)] font-black uppercase tracking-[0.2em] text-xs italic">{t('findings_table.no_threats', 'No active threats detected. Clean scan.')}</p>
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
                {t(`scan_results.severity.${sev.toLowerCase()}`, sev)} &nbsp;·&nbsp; {t('findings_table.findings_count', { count: items.length, defaultValue: '{{count}} findings' })}
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
                          <span style={{ fontSize: '0.7rem', color: 'var(--accent-secondary)', background: 'var(--accent-secondary)/0.08', padding: '2px 8px', borderRadius: '16px', border: '1px solid var(--accent-secondary)', fontWeight: 800, letterSpacing: '0.05em' }}>
                            {t('findings_table.policy_violation', 'POLICY VIOLATION')}
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.7rem', color: 'var(--severity-info)', background: 'var(--severity-info)/0.08', padding: '2px 8px', borderRadius: '16px', border: '1px solid var(--severity-info)', fontWeight: 800, letterSpacing: '0.05em' }}>
                            {t('findings_table.vulnerability', 'VULNERABILITY')}
                          </span>
                        )}
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                          <Package size={12} /> {finding.package}
                        </span>
                        
                        {finding.type !== 'policy_violation' && (
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', background: 'var(--bg-secondary)', padding: '2px 8px', borderRadius: '16px', border: '1px solid var(--border-subtle)' }}>
                            {t('findings_table.installed', 'installed')}: {finding.installedVersion}
                          </span>
                        )}
                        {finding.type !== 'policy_violation' && finding.fixedVersion && (
                          <span style={{ fontSize: '0.7rem', color: 'var(--status-success)', background: 'var(--status-success)/0.08', padding: '2px 8px', borderRadius: '16px', border: '1px solid var(--status-success)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Wrench size={10} /> {t('findings_table.fix', 'fix')}: {finding.fixedVersion}
                          </span>
                        )}
                        {finding.type !== 'policy_violation' && !finding.fixedVersion && (
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', background: 'var(--bg-secondary)', padding: '2px 8px', borderRadius: '16px', border: '1px solid var(--border-subtle)' }}>
                            {t('findings_table.no_fix', 'no fix available')}
                          </span>
                        )}
                        {onRemediate && (
                          <button
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              console.log('[DEBUG] Triggering Remediate for ID:', finding.$id);
                              if (!finding.$id) console.error('[ERROR] Finding ID is missing in FindingsTable:', finding);
                              onRemediate(finding.$id); 
                            }}
                            className="flex items-center gap-1 px-2 py-0.5 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border border-[var(--accent-primary)]/30 rounded-2xl text-[9px] font-black uppercase italic hover:bg-[var(--accent-primary)] hover:text-black transition-all ml-2"
                          >
                            <Zap size={10} /> {t('findings_table.remediate', 'Remediate')}
                          </button>
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
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6, background: 'var(--bg-primary)', padding: '12px 14px', borderRadius: '20px', border: '1px solid var(--border-subtle)', whiteSpace: 'pre-wrap' }}>
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
