import { useCallback, useEffect, useState } from 'react';
import { Shield, AlertCircle, Wind, ChevronDown, ChevronRight, Ticket as TicketIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTickets, createTicketFromFinding } from '../hooks/useTickets';
import { SLA_HOURS, slaHoursLeft, daysOverdue } from '../lib/sla';
import toast from 'react-hot-toast';


const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: '#ff5252', HIGH: '#ff8a00',
  MEDIUM: '#ffd740',  LOW: '#69f0ae', INFO: '#40c4ff'
};

const TYPE_ICON: Record<string, any> = {
  security: Shield, reliability: AlertCircle, maintainability: Wind
};

const SEVERITY_SCORE: Record<string, number> = {
  CRITICAL: 9.5, HIGH: 7.5, MEDIUM: 5.0, LOW: 2.5, INFO: 1.0
};

const SEVERITY_PRIORITY: Record<string, 'critical' | 'high' | 'medium' | 'low'> = {
  CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low', INFO: 'low'
};

// Mirrors backend computeRiskScore severity bases so unenriched (pre-migration)
// findings still rank sensibly instead of sinking to 0.
const RISK_FALLBACK: Record<string, number> = {
  CRITICAL: 50, HIGH: 35, MEDIUM: 20, LOW: 10, INFO: 5
};

const riskOf = (i: any): number =>
  typeof i.risk_score === 'number' ? i.risk_score : (RISK_FALLBACK[(i.severity || '').toUpperCase()] ?? 5);

const riskColor = (score: number): string =>
  score >= 75 ? '#ff5252' : score >= 50 ? '#ff8a00' : score >= 25 ? '#ffd740' : '#69f0ae';

const daysOpen = (createdAtIso: string): number =>
  Math.max(0, Math.floor((Date.now() - new Date(createdAtIso).getTime()) / 86_400_000));

const isSlaBreached = (i: any): boolean => slaHoursLeft(i.$createdAt, i.severity || '') < 0;

const buildIssueDescription = (issue: any): string =>
  `Issue detected by ${issue.tool || 'scanner'} in ${issue.file || 'workspace'}.\nMessage: ${issue.message}\n` +
  (issue.code ? `Code:\n${issue.code}` : '');

export default function Issues() {
  const { getJWT } = useAuth();
  const { tickets: allTickets, refetch: refetchTickets } = useTickets({});
  const [issues, setIssues] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState({ severity: '', type: '', tool: '' });
  const [sortBy, setSortBy] = useState<'risk' | 'newest'>('risk');
  const [loading, setLoading] = useState(true);
  // A failed load must not render as "0 issues" — an empty security list reads
  // as "you are clean", which is the opposite of what a fetch error means.
  const [loadFailed, setLoadFailed] = useState(false);
  const [latestScan, setLatestScan] = useState<any>(null);

  const handleCreateTicketFromFinding = async (issue: any) => {
    const sevStr = (issue.severity || '').toUpperCase();
    const severity = SEVERITY_SCORE[sevStr] ?? 2.5;

    return await createTicketFromFinding(getJWT, {
      findingId: issue.$id,
      title: issue.title || `Scan Finding in ${issue.file || 'Workspace'}`,
      description: buildIssueDescription(issue),
      severity,
      type: 'vulnerability'
    });
  };

  // Both loads go through the backend, which scopes findings and scans to the
  // repositories this caller owns or shares via a team. The previous direct
  // Appwrite queries carried no tenant filter at all.
  const fetchIssues = useCallback(async () => {
    setLoading(true);
    try {
        const token = await getJWT();
        const res = await fetch('/api/issues?limit=500', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`issues fetch failed: ${res.status}`);
        setIssues((await res.json())?.documents ?? []);
        setLoadFailed(false);
    } catch (err) {
        console.error('Failed to fetch issues:', err);
        setLoadFailed(true);
    } finally {
        setLoading(false);
    }
  }, [getJWT]);

  const fetchLatestScan = useCallback(async () => {
    try {
        const token = await getJWT();
        const res = await fetch('/api/dashboard/security', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`dashboard fetch failed: ${res.status}`);
        setLatestScan((await res.json())?.latest_scan ?? null);
    } catch (err) {
        console.error('Failed to fetch latest scan:', err);
    }
  }, [getJWT]);

  useEffect(() => {
    fetchIssues();
    fetchLatestScan();
  }, [fetchIssues, fetchLatestScan]);

  // 1. Map raw issues to synthetic types for metrics
  const mappedIssues = issues.map(i => {
    const t = i.type?.toLowerCase();
    let syntheticType = 'maintainability';
    if (t === 'security' || t === 'vulnerability' || i.tool?.toLowerCase() === 'trivy' || i.tool?.toLowerCase() === 'gitleaks' || i.severity === 'CRITICAL' || i.severity === 'HIGH') {
      syntheticType = 'security';
    } else if (t === 'reliability' || i.severity === 'MEDIUM') {
      syntheticType = 'reliability';
    } else {
      syntheticType = 'maintainability';
    }
    return { ...i, syntheticType };
  });

  // 2. Inline filter based on active states
  const filteredIssues = mappedIssues.filter(i => {
    if (filter.severity && i.severity !== filter.severity) return false;
    if (filter.tool && i.tool?.toLowerCase() !== filter.tool.toLowerCase()) return false;
    if (filter.type && i.syntheticType !== filter.type) return false;
    return true;
  });

  // 3. Compute accurate dashboard counts
  const counts: Record<string, number> = {
    security: mappedIssues.filter(i => i.syntheticType === 'security').length,
    reliability: mappedIssues.filter(i => i.syntheticType === 'reliability').length,
    maintainability: mappedIssues.filter(i => i.syntheticType === 'maintainability').length };

  // 4. Group by repository context (fixing 'unknown')
  const byGroup = filteredIssues.reduce((acc: any, issue: any) => {
    const f = issue.file || issue.repoName || latestScan?.repoName || 'Scorpion Workspace (Global Context)';
    if (!acc[f]) acc[f] = [];
    acc[f].push(issue);
    return acc;
  }, {});

  // 5. Order groups and issues within each group by the active sort
  const sortedGroups: [string, any[]][] = Object.entries(byGroup as Record<string, any[]>).map(
    ([file, fileIssues]) => {
      const sorted = [...fileIssues].sort((a, b) =>
        sortBy === 'risk'
          ? riskOf(b) - riskOf(a)
          : new Date(b.$createdAt).getTime() - new Date(a.$createdAt).getTime()
      );
      return [file, sorted] as [string, any[]];
    }
  );
  sortedGroups.sort(([, a], [, b]) =>
    sortBy === 'risk'
      ? riskOf(b[0]) - riskOf(a[0])
      : new Date(b[0].$createdAt).getTime() - new Date(a[0].$createdAt).getTime()
  );

  const totalEffortMins = filteredIssues.reduce((acc, i) => {
    return acc + parseInt(i.effort ?? '5');
  }, 0);

  return (
    <div className="p-6 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-primary)]">Issues</h1>
          <p className="text-[13px] text-[var(--text-secondary)] mt-1">Every finding across your repositories, by severity and scanner</p>
        </div>
        <div className="flex items-center gap-1 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg p-1" role="group" aria-label="Sort findings">
          {([['risk', 'Risk'], ['newest', 'Newest']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              aria-pressed={sortBy === key}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors cursor-pointer ${
                sortBy === key
                  ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* High-Performance Executive Banner Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Column 1: Operational Status Gauge */}
        <div className="bg-white p-4 rounded-xl border border-stone-200/60 flex flex-col justify-center shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[12px] font-medium text-stone-500">Quality gate</span>
            {/* No scan is not a passing gate. Defaulting to "passed / 100" told
                every never-scanned tenant their code was clean. */}
            <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium capitalize border ${
              !latestScan
                ? 'bg-stone-50 text-stone-500 border-stone-200'
                : (latestScan.gateStatus || '').toLowerCase() === 'failed'
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
            }`}>
              {latestScan ? (latestScan.gateStatus || 'unknown').toLowerCase() : 'never scanned'}
            </span>
          </div>
          <div>
            {latestScan ? (
              <p className="text-2xl font-semibold tabular-nums text-stone-800 tracking-tight">
                {latestScan.score ?? '—'}<span className="text-sm font-medium text-stone-400">/100</span>
              </p>
            ) : (
              <p className="text-[13px] text-stone-500">Run a scan to get a score</p>
            )}
          </div>
        </div>

        {/* Column 2: Dynamic Core Parameters */}
        <div className="bg-white p-4 rounded-xl border border-stone-200/60 flex flex-col justify-center shadow-sm">
          <span className="text-[12px] font-medium text-stone-500 mb-3">Ratings</span>
          <div className="flex items-center gap-2">
            {(['SECURITY', 'RELIABILITY', 'MAINTAINABILITY']).map(p => (
              <div key={p} className="flex-1 bg-stone-50 border border-stone-100 rounded-lg py-2 px-1 flex flex-col items-center justify-center">
                <p className="text-[11px] font-medium capitalize text-stone-500 mb-1 truncate w-full text-center">{p.toLowerCase()}</p>
                <p className="text-sm font-semibold text-stone-800">A</p>
              </div>
            ))}
          </div>
        </div>

        {/* Column 3: Project Remediation Target Effort */}
        <div className="bg-white p-4 rounded-xl border border-stone-200/60 flex flex-col justify-center shadow-sm">
          <span className="text-[12px] font-medium text-stone-500 mb-3">To remediate</span>
          <div className="flex flex-col gap-1">
            {loadFailed ? (
              <>
                <p className="text-2xl font-semibold text-stone-400 tracking-tight leading-none">—</p>
                <p className="text-[12px] text-[#ff8a00] font-medium mt-1">Unavailable, not zero</p>
              </>
            ) : (
              <>
                <p className="text-2xl font-semibold tabular-nums text-stone-800 tracking-tight leading-none">{filteredIssues.length} <span className="text-sm font-medium text-stone-400">issues</span></p>
                <p className="text-[12px] text-emerald-600 font-medium mt-1">
                  ~{Math.floor(totalEffortMins / 60)}h {totalEffortMins % 60}m to fix
                </p>
                {(() => {
                  const breached = filteredIssues.filter(isSlaBreached).length;
                  return breached > 0 ? (
                    <p className="text-[12px] text-[#ff5252] font-semibold" title="Findings open past their severity SLA window">
                      {breached} past SLA
                    </p>
                  ) : null;
                })()}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Dual-Panel Grid Split */}
      <div className="grid grid-cols-1 lg:grid-cols-10 gap-6">
        
        {/* Sidebar Filter Column (lg:col-span-3) */}
        <div className="lg:col-span-3 flex flex-col gap-6">
          {/* Type summary cards (Stacked vertically) */}
          <div className="flex flex-col gap-3">
            {(['security', 'reliability', 'maintainability'] as const).map(t => {
              const Icon = TYPE_ICON[t];
              return (
                <button key={t}
                  onClick={() => setFilter(f => ({ ...f, type: f.type === t ? '' : t }))}
                  className={`premium-card p-4 text-left transition-all ${filter.type === t ? 'border-[var(--accent-primary)]' : ''}`}>
                  <div className="flex items-center gap-3 mb-2">
                    <Icon className="w-5 h-5 text-[var(--accent-primary)]" />
                    <span className="text-[13px] font-medium capitalize text-[var(--text-secondary)]">{t}</span>
                  </div>
                  <p className="text-3xl font-semibold tabular-nums">{loadFailed ? '—' : counts[t]}</p>
                </button>
              );
            })}
          </div>

          {/* Filters (Unified vertical control board) */}
          <div className="flex flex-col gap-5 bg-[var(--bg-card)] border border-[var(--border-subtle)] p-5 rounded-[12px] shadow-[0_4px_16px_rgba(0,0,0,0.02)]">
            <div>
              <p className="text-[12px] font-medium text-[var(--text-secondary)] mb-3">Severity</p>
              <div className="flex gap-2 flex-wrap">
                {['CRITICAL','HIGH','MEDIUM','LOW'].map(s => (
                  <button key={s}
                    onClick={() => setFilter(f => ({ ...f, severity: f.severity === s ? '' : s }))}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all"
                    style={{
                      borderColor: filter.severity === s ? SEVERITY_COLOR[s] : 'var(--border-subtle)',
                      color: SEVERITY_COLOR[s],
                      background: filter.severity === s ? `${SEVERITY_COLOR[s]}15` : 'transparent'
                    }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-px w-full bg-[var(--border-subtle)]"></div>
            <div>
              <p className="text-[12px] font-medium text-[var(--text-secondary)] mb-3">Scanner</p>
              <div className="flex gap-2 flex-wrap">
                {['semgrep','trivy','gitleaks'].map(t => (
                  <button key={t}
                    onClick={() => setFilter(f => ({ ...f, tool: f.tool === t ? '' : t }))}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all ${filter.tool === t ? 'border-[var(--accent-primary)] text-[var(--accent-primary)]' : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Vulnerability Roster Column (lg:col-span-7) */}
        <div className="lg:col-span-7">
          {loading ? (
            <div className="text-center py-20 text-[var(--text-secondary)] animate-pulse text-sm uppercase tracking-widest">
              Loading issues...
            </div>
          ) : loadFailed ? (
            <div className="premium-card p-8 text-center">
              <AlertCircle className="w-6 h-6 text-[#ff8a00] mx-auto mb-3" />
              <p className="text-[14px] font-medium text-[var(--text-primary)]">Couldn't load findings</p>
              <p className="text-[12px] text-[var(--text-secondary)] mt-1">
                This is not an empty list — your findings could not be read. Retry, and check back before treating this repository as clean.
              </p>
              <button
                onClick={fetchIssues}
                className="mt-4 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border border-[var(--accent-primary)]/20 hover:bg-[var(--accent-primary)] hover:text-white transition-all">
                Retry
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {sortedGroups.map(([file, fileIssues]: any) => (
                <div key={file} className="premium-card overflow-hidden">
                  {/* File header */}
                  <button
                    onClick={() => setExpanded(expanded === file ? null : file)}
                    className="w-full flex items-center justify-between p-4 hover:bg-[var(--bg-primary)]/40 transition-colors">
                    <div className="flex items-center gap-3">
                      {expanded === file
                        ? <ChevronDown className="w-4 h-4 text-[var(--accent-primary)]" />
                        : <ChevronRight className="w-4 h-4 text-[var(--text-secondary)]" />}
                      <span className="text-[11px] font-mono text-[var(--text-primary)]">{file}</span>
                      <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase">{fileIssues.length} issues</span>
                    </div>
                    <div className="flex gap-2 items-center">
                      {fileIssues.some((i: any) => i.kev) && (
                        <span className="text-[9px] font-black px-2 py-0.5 rounded uppercase bg-[#ff5252] text-white"
                          title="Contains findings in CISA Known Exploited Vulnerabilities catalog">
                          KEV
                        </span>
                      )}
                      {(() => {
                        const maxRisk = Math.max(...fileIssues.map(riskOf));
                        return (
                          <span className="text-[9px] font-black px-2 py-0.5 rounded tabular-nums"
                            style={{ background: `${riskColor(maxRisk)}15`, color: riskColor(maxRisk) }}
                            title="Highest risk score in this file (severity + EPSS exploit probability + KEV)">
                            RISK {maxRisk}
                          </span>
                        );
                      })()}
                      {['CRITICAL','HIGH','MEDIUM','LOW'].map(s => {
                        const count = fileIssues.filter((i: any) => i.severity === s).length;
                        if (!count) return null;
                        return (
                          <span key={s} className="text-[9px] font-black px-2 py-0.5 rounded"
                            style={{ background: `${SEVERITY_COLOR[s]}15`, color: SEVERITY_COLOR[s] }}>
                            {count} {s}
                          </span>
                        );
                      })}
                    </div>
                  </button>

                  {/* Issue rows */}
                  {expanded === file && (
                    <div className="border-t border-[var(--border-subtle)]">
                      {fileIssues.map((issue: any) => {
                        const existingTicket = allTickets.find(t => t.linkedFindings && t.linkedFindings.includes(issue.$id));
                        return (
                          <IssueRow 
                            key={issue.$id} 
                            issue={issue} 
                            existingTicket={existingTicket}
                            onCreateTicketFromFinding={handleCreateTicketFromFinding}
                            refetchTickets={refetchTickets}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function IssueRow({ 
  issue, 
  existingTicket, 
  onCreateTicketFromFinding,
  refetchTickets
}: { 
  issue: any; 
  existingTicket?: any; 
  onCreateTicketFromFinding: (issue: any) => Promise<any>;
  refetchTickets: () => void;
}) {
  const [showCode, setShowCode] = useState(false);
  const [createdTicketInfo, setCreatedTicketInfo] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-primary)]/15 transition-colors flex flex-col">
      <div className="flex items-center justify-between w-full px-5 py-3 gap-4">
        {/* Main click area to toggle code */}
        <div 
          onClick={() => setShowCode(!showCode)}
          className="flex-1 flex items-center gap-4 cursor-pointer min-w-0"
        >
          {/* Severity dot */}
          <div className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: SEVERITY_COLOR[issue.severity] }} />

          {/* Title + message */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[11px] font-black text-[var(--text-primary)] truncate">{issue.title}</span>
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded uppercase flex-shrink-0"
                style={{ background: `${SEVERITY_COLOR[issue.severity]}15`, color: SEVERITY_COLOR[issue.severity] }}>
                {issue.severity}
              </span>
              {issue.kev && (
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded uppercase flex-shrink-0 bg-[#ff5252] text-white"
                  title="Listed in CISA Known Exploited Vulnerabilities catalog — actively exploited in the wild">
                  KEV
                </span>
              )}
            </div>
            <p className="text-[10px] text-[var(--text-secondary)] truncate">{issue.message}</p>
          </div>

          {/* Risk score (severity + EPSS + KEV) */}
          <span className="text-[10px] font-black tabular-nums px-2 py-0.5 rounded flex-shrink-0"
            style={{ background: `${riskColor(riskOf(issue))}15`, color: riskColor(riskOf(issue)) }}
            title="Risk score 0-100: severity base + EPSS exploit probability + KEV membership">
            {riskOf(issue)}
          </span>

          {/* EPSS exploit probability */}
          {typeof issue.epss_score === 'number' && (
            <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase flex-shrink-0 tabular-nums"
              title={`EPSS: ${(issue.epss_score * 100).toFixed(1)}% probability of exploitation in the next 30 days${typeof issue.epss_percentile === 'number' ? ` (${Math.round(issue.epss_percentile * 100)}th percentile)` : ''}`}>
              EPSS {(issue.epss_score * 100).toFixed(issue.epss_score < 0.1 ? 1 : 0)}%
            </span>
          )}

          {/* Line number */}
          {issue.line > 0 && (
            <span className="text-[10px] font-mono text-[var(--accent-primary)] flex-shrink-0">
              L{issue.line}{issue.endLine > issue.line ? `–${issue.endLine}` : ''}
            </span>
          )}

          {/* Age + SLA status */}
          {isSlaBreached(issue) ? (
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded uppercase flex-shrink-0 bg-[#ff5252]/15 text-[#ff5252] tabular-nums"
              title={`SLA breached: ${(issue.severity || 'medium').toLowerCase()} findings must be fixed within ${Math.round((SLA_HOURS[(issue.severity || '').toLowerCase()] ?? 168) / 24)}d — ${daysOverdue(issue.$createdAt, issue.severity || '')}d overdue`}>
              SLA +{daysOverdue(issue.$createdAt, issue.severity || '')}d
            </span>
          ) : (
            <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase flex-shrink-0 tabular-nums"
              title={`Open ${daysOpen(issue.$createdAt)} days — within the ${Math.round((SLA_HOURS[(issue.severity || '').toLowerCase()] ?? 168) / 24)}d SLA window for ${(issue.severity || 'medium').toLowerCase()}`}>
              {daysOpen(issue.$createdAt)}d
            </span>
          )}

          {/* Effort */}
          <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase flex-shrink-0">
            {issue.effort}
          </span>

          {/* Tool badge */}
          <span className="text-[9px] font-black px-2 py-0.5 rounded uppercase flex-shrink-0
            bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
            {issue.tool}
          </span>
        </div>

        {/* Ticket Action Area */}
        <div className="flex-shrink-0 flex items-center">
          {existingTicket ? (
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 bg-stone-100 text-stone-500 border border-stone-200 rounded-full text-[11px] font-medium">
                Ticketed
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/tickets/${existingTicket.id}`);
                }}
                className="flex items-center gap-1 px-2.5 py-1 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border border-[var(--accent-primary)]/20 rounded-full text-[11px] font-medium hover:bg-[var(--accent-primary)] hover:text-white transition-all"
              >
                <TicketIcon size={10} /> View ticket
              </button>
            </div>
          ) : createdTicketInfo ? (
            <div className="flex flex-col items-end gap-1">
              <span className="text-[10px] font-bold text-emerald-500">Ticket created — {createdTicketInfo.id}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/tickets/${createdTicketInfo.id}`);
                }}
                className="text-cyan-400 underline hover:text-cyan-300 text-[10px] font-semibold"
              >
                View Ticket
              </button>
            </div>
          ) : (
            <button
              disabled={creating}
              onClick={async (e) => {
                e.stopPropagation();
                setCreating(true);
                const toastId = toast.loading('Creating ticket...');
                try {
                  const t = await onCreateTicketFromFinding(issue);
                  setCreatedTicketInfo(t);
                  refetchTickets();
                  toast.success(`Ticket ${t.id} created successfully!`, { id: toastId });
                } catch (err: any) {
                  toast.error(err.message || 'Failed to create ticket', { id: toastId });
                } finally {
                  setCreating(false);
                }
              }}
              className="flex items-center gap-1 px-2.5 py-1 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border border-[var(--accent-primary)]/20 rounded-full text-[11px] font-medium hover:bg-[var(--accent-primary)] hover:text-white transition-all disabled:opacity-50"
            >
              <TicketIcon size={10} /> Create ticket
            </button>
          )}
        </div>
      </div>

      {/* Code snippet */}
      {showCode && issue.code && (
        <div className="px-5 pb-4">
          <pre className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg p-4
            text-[10px] font-mono text-[var(--text-secondary)] overflow-x-auto leading-relaxed
            whitespace-pre-wrap">
            {issue.code}
          </pre>
        </div>
      )}
    </div>
  );
}
