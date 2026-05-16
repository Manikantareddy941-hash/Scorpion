import { useEffect, useState } from 'react';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { Shield, AlertCircle, Bug, Wind, ChevronDown, ChevronRight } from 'lucide-react';
import { QualityGateCard } from '../components/QualityGate';

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: '#ff5252', HIGH: '#ff8a00',
  MEDIUM: '#ffd740',  LOW: '#69f0ae', INFO: '#40c4ff'
};

const TYPE_ICON: Record<string, any> = {
  security: Shield, reliability: AlertCircle, maintainability: Wind
};

export default function Issues() {
  const [issues, setIssues] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState({ severity: '', type: '', tool: '' });
  const [loading, setLoading] = useState(true);
  const [latestScan, setLatestScan] = useState<any>(null);

  useEffect(() => { 
    fetchIssues();
    fetchLatestScan();
  }, [filter]);

  const fetchIssues = async () => {
    setLoading(true);
    try {
        const filters = [Query.orderDesc('$createdAt'), Query.limit(500)];
        if (filter.severity) filters.push(Query.equal('severity', filter.severity));
        if (filter.type) filters.push(Query.equal('type', filter.type));
        if (filter.tool) filters.push(Query.equal('tool', filter.tool));

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

  // Group by file
  const byFile = issues.reduce((acc: any, issue: any) => {
    const f = issue.file || 'unknown';
    if (!acc[f]) acc[f] = [];
    acc[f].push(issue);
    return acc;
  }, {});

  const counts = {
    security: issues.filter(i => i.type === 'security').length,
    reliability: issues.filter(i => i.type === 'reliability').length,
    maintainability: issues.filter(i => i.type === 'maintainability').length,
  };

  const totalEffortMins = issues.reduce((acc, i) => {
    return acc + parseInt(i.effort ?? '5');
  }, 0);

  return (
    <div className="p-6 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black uppercase italic tracking-tighter">Issues</h1>
          <p className="text-[var(--text-secondary)] text-sm mt-1">
            {issues.length} issues · {Math.round(totalEffortMins / 60)}h {totalEffortMins % 60}min effort
          </p>
        </div>
      </div>

      {/* Quality Gate Card */}
      <div className="mb-8 max-w-2xl">
        <QualityGateCard scan={latestScan} loading={loading} />
      </div>

      {/* Type summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {(['security', 'reliability', 'maintainability'] as const).map(t => {
          const Icon = TYPE_ICON[t];
          return (
            <button key={t}
              onClick={() => setFilter(f => ({ ...f, type: f.type === t ? '' : t }))}
              className={`premium-card p-5 text-left transition-all ${filter.type === t ? 'border-[var(--accent-primary)]' : ''}`}>
              <div className="flex items-center gap-3 mb-2">
                <Icon className="w-5 h-5 text-[var(--accent-primary)]" />
                <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">{t}</span>
              </div>
              <p className="text-3xl font-black italic">{counts[t]}</p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6 flex-wrap">
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
        {['semgrep','trivy','gitleaks'].map(t => (
          <button key={t}
            onClick={() => setFilter(f => ({ ...f, tool: f.tool === t ? '' : t }))}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all ${filter.tool === t ? 'border-[var(--accent-primary)] text-[var(--accent-primary)]' : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Issues grouped by file */}
      {loading ? (
        <div className="text-center py-20 text-[var(--text-secondary)] animate-pulse text-sm uppercase tracking-widest">
          Loading issues...
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {Object.entries(byFile).map(([file, fileIssues]: any) => (
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
                  {fileIssues.map((issue: any) => (
                    <IssueRow key={issue.$id} issue={issue} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IssueRow({ issue }: { issue: any }) {
  const [showCode, setShowCode] = useState(false);

  return (
    <div className="border-b border-[var(--border-subtle)] last:border-0">
      <button
        onClick={() => setShowCode(!showCode)}
        className="w-full flex items-center gap-4 px-5 py-3 hover:bg-[var(--bg-primary)]/30 transition-colors text-left">

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
      </button>

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
