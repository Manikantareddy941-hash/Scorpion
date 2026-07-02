import { useEffect, useState } from 'react';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { Shield, AlertCircle, Wind, ChevronDown, ChevronRight, Ticket as TicketIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTickets, createTicketFromFinding } from '../hooks/useTickets';
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

const buildIssueDescription = (issue: any): string =>
  `Issue detected by ${issue.tool || 'scanner'} in ${issue.file || 'workspace'}.\nMessage: ${issue.message}\n` +
  (issue.code ? `Code:\n${issue.code}` : '');

export default function Issues() {
  const { getJWT } = useAuth();
  const { tickets: allTickets, refetch: refetchTickets } = useTickets({});
  const [issues, setIssues] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState({ severity: '', type: '', tool: '' });
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    fetchIssues();
    fetchLatestScan();
  }, []);

  const fetchIssues = async () => {
    setLoading(true);
    try {
        const filters = [Query.orderDesc('$createdAt'), Query.limit(500)];
        const res = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, filters);
        setIssues(res.documents);
    } catch (err) {
        console.error('Failed to fetch issues:', err);
    } finally {
        setLoading(false);
    }
  };

  const fetchLatestScan = async () => {
    try {
        const res = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.orderDesc('$createdAt'),
            Query.limit(1)
        ]);
        if (res.documents.length > 0) {
            setLatestScan(res.documents[0]);
        }
    } catch (err) {
        console.error('Failed to fetch latest scan:', err);
    }
  };

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

  const totalEffortMins = filteredIssues.reduce((acc, i) => {
    return acc + parseInt(i.effort ?? '5');
  }, 0);

  return (
    <div className="p-6 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-black uppercase italic tracking-tighter">Issues</h1>
      </div>

      {/* High-Performance Executive Banner Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Column 1: Operational Status Gauge */}
        <div className="bg-white p-4 rounded-xl border border-stone-200/60 flex flex-col justify-center shadow-sm relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
          <div className="flex items-center justify-between mb-4 pl-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-stone-500">Quality Gate</span>
            <span className="bg-stone-100 text-stone-600 border border-stone-200 px-3 py-1 rounded text-xs uppercase font-mono font-bold">
              {latestScan?.gateStatus || 'PASSED'}
            </span>
          </div>
          <div className="pl-2">
            <p className="text-2xl font-black text-stone-800 tracking-tight">Score: {latestScan?.score || '100'}/100</p>
          </div>
        </div>

        {/* Column 2: Dynamic Core Parameters */}
        <div className="bg-white p-4 rounded-xl border border-stone-200/60 flex flex-col justify-center shadow-sm">
          <span className="text-[10px] font-black uppercase tracking-widest text-stone-500 mb-3">Core Parameters</span>
          <div className="flex items-center gap-2">
            {(['SECURITY', 'RELIABILITY', 'MAINTAINABILITY']).map(p => (
              <div key={p} className="flex-1 bg-stone-50 border border-stone-100 rounded-lg py-2 px-1 flex flex-col items-center justify-center">
                <p className="text-[8px] font-black uppercase tracking-widest text-stone-500 mb-1 truncate w-full text-center">{p}</p>
                <p className="text-sm font-black text-stone-800">Grade: A</p>
              </div>
            ))}
          </div>
        </div>

        {/* Column 3: Project Remediation Target Effort */}
        <div className="bg-white p-4 rounded-xl border border-stone-200/60 flex flex-col justify-center shadow-sm">
          <span className="text-[10px] font-black uppercase tracking-widest text-stone-500 mb-3">Remediation Target</span>
          <div className="flex flex-col gap-1">
            <p className="text-2xl font-black text-stone-800 tracking-tight leading-none">{filteredIssues.length} <span className="text-sm font-bold text-stone-500 uppercase tracking-normal">issues</span></p>
            <p className="text-[11px] font-mono text-emerald-600 font-bold tracking-widest uppercase">
              {Math.floor(totalEffortMins / 60)}h {totalEffortMins % 60}min effort
            </p>
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
                    <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">{t}</span>
                  </div>
                  <p className="text-3xl font-black italic">{counts[t]}</p>
                </button>
              );
            })}
          </div>

          {/* Filters (Unified vertical control board) */}
          <div className="flex flex-col gap-5 bg-[var(--bg-card)] border border-[var(--border-subtle)] p-5 rounded-[12px] shadow-[0_4px_16px_rgba(0,0,0,0.02)]">
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-secondary)] mb-3">Severity Filters</p>
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
              <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-secondary)] mb-3">Scanner Engines</p>
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
          ) : (
            <div className="flex flex-col gap-3">
              {Object.entries(byGroup).map(([file, fileIssues]: any) => (
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
                    <div className="flex gap-2">
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
            </div>
            <p className="text-[10px] text-[var(--text-secondary)] truncate">{issue.message}</p>
          </div>

          {/* Line number */}
          {issue.line > 0 && (
            <span className="text-[10px] font-mono text-[var(--accent-primary)] flex-shrink-0">
              L{issue.line}{issue.endLine > issue.line ? `–${issue.endLine}` : ''}
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
              <span className="px-2.5 py-1 bg-stone-500/10 text-stone-400 border border-stone-500/30 rounded-2xl text-[9px] font-black uppercase italic">
                Ticketed
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/tickets/${existingTicket.id}`);
                }}
                className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-2xl text-[9px] font-black uppercase italic hover:bg-emerald-500 hover:text-black transition-all"
              >
                <TicketIcon size={10} /> View Ticket
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
              className="flex items-center gap-1 px-2.5 py-1 bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 rounded-2xl text-[9px] font-black uppercase italic hover:bg-cyan-500 hover:text-black transition-all disabled:opacity-50"
            >
              <TicketIcon size={10} /> Create Ticket
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
