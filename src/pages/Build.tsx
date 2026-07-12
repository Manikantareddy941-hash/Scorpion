import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
  Hammer, CheckCircle2, XCircle, Clock, RefreshCw, Terminal, ChevronDown, ChevronUp, Play, GitBranch, User, Tag
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function Build() {
  const { getJWT } = useAuth();
  const [runs, setRuns] = useState<any[]>([]);
  const [repos, setRepos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [selectedRepoId, setSelectedRepoId] = useState<string>('');
  const [selectedBranch, setSelectedBranch] = useState<string>('main');
  const [triggering, setTriggering] = useState(false);

  // AbortController for the live fetch-based SSE stream. We use fetch (not
  // EventSource) so the session JWT rides in the Authorization header instead of
  // the URL query string — a token in the URL leaks into access logs, proxies,
  // and browser history.
  const sseRef = useRef<AbortController | null>(null);
  const logsIntervalRef = useRef<any | null>(null);
  const sseCleanupRef = useRef<(() => void) | null>(null);

  const fetchRepos = async () => {
    try {
      const token = await getJWT();
      const res = await fetch('/api/repos', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setRepos(data.documents || []);
        if (data.documents && data.documents.length > 0) {
          setSelectedRepoId(data.documents[0].$id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch repos:', err);
    }
  };

  const fetchRuns = async () => {
    try {
      const token = await getJWT();
      const res = await fetch('/api/pipelines/runs', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setRuns(data.documents || []);
      }
    } catch (err) {
      console.error('Failed to fetch pipeline runs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRepos();
    fetchRuns();
    const interval = setInterval(fetchRuns, 8000);
    return () => {
      clearInterval(interval);
      if (sseCleanupRef.current) sseCleanupRef.current();
      if (sseRef.current) sseRef.current.abort();
      if (logsIntervalRef.current) clearInterval(logsIntervalRef.current);
    };
  }, []);

  const triggerPipeline = async () => {
    if (!selectedRepoId) {
      toast.error('Please select a repository');
      return;
    }
    try {
      setTriggering(true);
      const token = await getJWT();
      toast.loading("Triggering pipeline execution...", { id: 'pipeline' });
      const res = await fetch('/api/pipelines/trigger', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ repoId: selectedRepoId, branch: selectedBranch })
      });
      
      if (res.ok) {
        toast.success("Pipeline run successfully triggered!", { id: 'pipeline' });
        fetchRuns();
      } else {
        toast.error("Failed to trigger pipeline run", { id: 'pipeline' });
      }
    } catch (err) {
      toast.error("Error triggering pipeline run", { id: 'pipeline' });
    } finally {
      setTriggering(false);
    }
  };

  const fetchLogs = async (runId: string) => {
    try {
      setLogsLoading(true);
      const token = await getJWT();
      const res = await fetch(`/api/pipelines/run/${runId}/logs`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.text();
        setLogs(data);
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    } finally {
      setLogsLoading(false);
    }
  };

  const handleExpandRun = (runId: string) => {
    // Clear any active SSE and intervals
    if (sseCleanupRef.current) {
      sseCleanupRef.current();
      sseCleanupRef.current = null;
    }
    if (sseRef.current) {
      sseRef.current.abort();
      sseRef.current = null;
    }
    if (logsIntervalRef.current) {
      clearInterval(logsIntervalRef.current);
      logsIntervalRef.current = null;
    }

    if (expandedRunId === runId) {
      setExpandedRunId(null);
      setLogs('');
      return;
    }

    setExpandedRunId(runId);
    setLogs('');
    fetchLogs(runId);

    const run = runs.find(r => r.$id === runId);
    
    // If pipeline run is active/running, establish SSE connection and poll logs
    if (run && (run.status === 'running' || run.status === 'pending')) {
      let reconnectTimeout: any = null;
      let active = true;

      sseCleanupRef.current = () => {
        active = false;
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
        }
      };

      // Applies one parsed SSE payload to local state.
      const handleEvent = (data: any) => {
        setRuns(prev => prev.map(r => {
          if (r.$id === runId) {
            const updated = { ...r };
            if (data.stage) {
              updated[`${data.stage}Status`] = data.status;
              updated.currentStage = data.stage;
            }
            if (data.status === 'success' || data.status === 'failed') {
              fetchRuns();
            }
            return updated;
          }
          return r;
        }));
        fetchLogs(runId);
      };

      // Schedules a reconnect if the run is still active. Shared by the stream-end
      // and error paths so a dropped connection resumes just like EventSource did.
      const scheduleReconnect = () => {
        if (!active) return;
        reconnectTimeout = setTimeout(async () => {
          try {
            const token = await getJWT();
            const res = await fetch(`/api/pipelines/run/${runId}`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
              const data = await res.json();
              if (data && (data.status === 'running' || data.status === 'pending')) {
                connect();
              }
            }
          } catch (err) {
            console.error('[SSE] Reconnect check failed:', err);
          }
        }, 3000);
      };

      const connect = async () => {
        if (!active) return;
        try {
          const token = await getJWT();
          if (!active) return;

          if (sseRef.current) {
            sseRef.current.abort();
          }

          // fetch-based SSE: the JWT goes in the Authorization header (EventSource
          // can't set headers, which is why the old code leaked it via ?token=).
          const controller = new AbortController();
          sseRef.current = controller;

          const res = await fetch(`/api/pipelines/run/${runId}/stream`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
            signal: controller.signal,
          });

          if (!res.ok || !res.body) {
            if (active) scheduleReconnect();
            return;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          // Read the stream frame-by-frame. SSE frames are separated by a blank
          // line; each frame's payload is the concatenation of its `data:` lines.
          while (active) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split('\n\n');
            buffer = frames.pop() ?? '';
            for (const frame of frames) {
              const dataLine = frame
                .split('\n')
                .filter(l => l.startsWith('data:'))
                .map(l => l.slice(5).trim())
                .join('\n');
              if (!dataLine) continue; // handshake/keepalive comment
              try {
                handleEvent(JSON.parse(dataLine));
              } catch {
                // partial/non-JSON frame — skip
              }
            }
          }

          // Stream ended (server closed or run finished). Reconnect if still active.
          if (active) scheduleReconnect();
        } catch (err) {
          // AbortError is our own teardown — not a real failure.
          if ((err as Error)?.name === 'AbortError') return;
          console.warn('[SSE] Connection lost. Attempting reconnect in 3s...');
          scheduleReconnect();
        }
      };

      connect();

      // 2. Poll logs every 2.5 seconds during active running
      logsIntervalRef.current = setInterval(() => {
        fetchLogs(runId);
      }, 2500);
    }
  };

  const getStageBadge = (status: string, label: string) => {
    let classes = 'border-gray-500/20 text-gray-400 bg-gray-500/5';
    let icon = <Clock className="w-3.5 h-3.5 shrink-0" />;

    if (status === 'success') {
      classes = 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10';
      icon = <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />;
    } else if (status === 'failed') {
      classes = 'border-red-500/30 text-red-400 bg-red-500/10';
      icon = <XCircle className="w-3.5 h-3.5 shrink-0 text-red-500" />;
    } else if (status === 'running') {
      classes = 'border-amber-500/30 text-amber-400 bg-amber-500/10';
      icon = <RefreshCw className="w-3.5 h-3.5 shrink-0 text-amber-500 animate-spin" />;
    }

    return (
      <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-wider ${classes}`}>
        {icon}
        <span>{label}</span>
      </div>
    );
  };

  const getOverallStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle2 className="w-6 h-6 text-emerald-500" />;
      case 'failed': return <XCircle className="w-6 h-6 text-red-500" />;
      case 'running': return <RefreshCw className="w-6 h-6 text-amber-500 animate-spin" />;
      default: return <Clock className="w-6 h-6 text-gray-500" />;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 pb-6 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-[var(--accent-primary)]/10 rounded-2xl flex items-center justify-center border border-[var(--accent-primary)]/20 shadow-[0_0_20px_rgba(var(--accent-primary-rgb),0.1)]">
            <Hammer className="w-7 h-7 text-[var(--accent-primary)]" />
          </div>
          <div>
            <h1 className="text-[22px] font-semibold text-[var(--text-primary)] tracking-tight">Pipelines</h1>
            <p className="text-[13px] text-[var(--text-secondary)] mt-1">Run and track CI/CD pipelines for your repositories</p>
          </div>
        </div>

        {/* Manual Trigger Panel */}
        <div className="flex flex-wrap items-center gap-4 bg-[var(--bg-card)] p-4 rounded-2xl border border-[var(--border-subtle)]">
          <div className="flex flex-col">
            <label className="text-[12px] font-medium text-[var(--text-secondary)] mb-1">Repository</label>
            <select
              value={selectedRepoId}
              onChange={(e) => setSelectedRepoId(e.target.value)}
              className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs font-bold text-[var(--text-primary)] outline-none min-w-[200px]"
            >
              {repos.map(r => (
                <option key={r.$id} value={r.$id}>{r.name || r.url?.split('/').pop()}</option>
              ))}
              {repos.length === 0 && <option value="">No Repositories Available</option>}
            </select>
          </div>

          <div className="flex flex-col">
            <label className="text-[12px] font-medium text-[var(--text-secondary)] mb-1">Branch</label>
            <input
              type="text"
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              placeholder="e.g. main"
              className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs font-bold text-[var(--text-primary)] outline-none max-w-[100px]"
            />
          </div>

          <button
            onClick={triggerPipeline}
            disabled={triggering || repos.length === 0}
            className="btn-premium flex items-center gap-2 self-end py-2"
          >
            {triggering ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
            <span>Run Pipeline</span>
          </button>
        </div>
      </div>

      {/* Main List */}
      <div className="space-y-4">
        {loading && runs.length === 0 ? (
          <div className="flex justify-center py-20">
            <RefreshCw className="w-10 h-10 animate-spin text-[var(--accent-primary)]" />
          </div>
        ) : runs.length === 0 ? (
          <div className="premium-card p-16 text-center text-[var(--text-secondary)] text-[14px]">
            No pipeline runs detected. Push code or trigger manually to execute a pipeline.
          </div>
        ) : (
          runs.map(run => (
            <div key={run.$id} className="premium-card overflow-hidden transition-all duration-300">
              <div 
                onClick={() => handleExpandRun(run.$id)}
                className="p-6 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-6 cursor-pointer hover:bg-white/5 transition-all"
              >
                {/* Left side info */}
                <div className="flex items-start gap-4 flex-1">
                  <div className="mt-1">{getOverallStatusIcon(run.status)}</div>
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="font-mono text-xs font-bold text-[var(--text-primary)] bg-[var(--bg-primary)] px-2 py-1 rounded border border-[var(--border-subtle)] uppercase">
                        {run.repoName}
                      </span>
                      <span className="flex items-center gap-1 text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                        <GitBranch size={12} /> {run.branch}
                      </span>
                      <span className="flex items-center gap-1 text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider font-mono">
                        <Tag size={12} /> {run.commitHash ? run.commitHash.slice(0, 7) : '—'}
                      </span>
                    </div>

                    <h3 className="text-sm font-bold text-[var(--text-primary)] truncate max-w-[500px]">
                      {run.commitMessage || 'Automated pipeline run'}
                    </h3>

                    <div className="flex flex-wrap gap-4 text-[9px] font-black uppercase tracking-wider text-[var(--text-secondary)]">
                      <span className="flex items-center gap-1"><User size={10} /> Triggered by: {run.author}</span>
                      <span className="flex items-center gap-1"><Clock size={10} /> Duration: {run.duration ? `${run.duration}s` : '—'}</span>
                    </div>
                  </div>
                </div>

                {/* Live Stages Badge Row */}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {getStageBadge(run.triggerStatus, 'Trigger')}
                  {getStageBadge(run.buildStatus, 'Build')}
                  {getStageBadge(run.testStatus, 'Test')}
                  {getStageBadge(run.securityScanStatus, 'Scan')}
                  {getStageBadge(run.gateCheckStatus, 'Gate')}
                  {getStageBadge(run.deployStatus, 'Deploy')}
                </div>

                {/* Expand Toggle */}
                <div className="shrink-0 pl-4 border-l border-[var(--border-subtle)] hidden xl:block">
                  {expandedRunId === run.$id ? <ChevronUp className="w-5 h-5 text-[var(--text-secondary)]" /> : <ChevronDown className="w-5 h-5 text-[var(--text-secondary)]" />}
                </div>
              </div>

              {/* Logs Drawer */}
              {expandedRunId === run.$id && (
                <div className="border-t border-[var(--border-subtle)] bg-[#090d13] p-6 space-y-4">
                  <div className="flex items-center justify-between border-b border-gray-800 pb-3">
                    <div className="flex items-center gap-2 text-zinc-400">
                      <Terminal className="w-4 h-4 text-[var(--accent-primary)]" />
                      <span className="text-xs font-mono font-bold uppercase tracking-wider">Console output logs</span>
                    </div>
                    {run.status === 'running' && (
                      <div className="flex items-center gap-2 text-amber-500 animate-pulse text-[9px] font-black uppercase tracking-widest">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Streaming logs live via SSE</span>
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-zinc-800 bg-[#0d1117] p-5 h-80 overflow-y-auto font-mono text-[10px] text-zinc-300 whitespace-pre-wrap leading-relaxed shadow-inner">
                    {logsLoading && !logs ? (
                      <div className="flex justify-center items-center h-full">
                        <RefreshCw className="w-6 h-6 animate-spin text-[var(--text-secondary)]" />
                      </div>
                    ) : logs ? (
                      logs
                    ) : (
                      'No logs registered for this stage run.'
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
