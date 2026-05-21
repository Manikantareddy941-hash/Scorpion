import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  TestTube2, CheckCircle2, XCircle, AlertCircle, RefreshCw, BarChart, GitBranch, TerminalSquare, ShieldAlert
} from 'lucide-react';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import toast from 'react-hot-toast';

export default function TestResults() {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState({ testExecutions: 0, codeCoverage: 0, failedTests: 0 });
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<any | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchLivePipelineData = async () => {
    try {
      setLoading(true);
      const response = await databases.listDocuments(DB_ID, COLLECTIONS.TEST_RUNS, [
        Query.orderDesc('$createdAt'),
        Query.limit(1)
      ]);

      if (response.documents.length > 0) {
        const latestRun = response.documents[0];
        
        setMetrics({
          testExecutions: latestRun.total_tests || latestRun.testExecutions || 0,
          codeCoverage: latestRun.coverage || latestRun.codeCoverage || 0,
          failedTests: latestRun.failed_tests || latestRun.failedTests || 0
        });

        if (latestRun.logStreamString) {
          try {
            setLogs(JSON.parse(latestRun.logStreamString));
          } catch(e) {
            console.error("Failed to parse logs", e);
            setLogs([]);
          }
        } else {
          setLogs([
            { id: "sys-1", timestamp: new Date().toLocaleTimeString(), stage: "SYSTEM", status: "PASSED", message: "Pipeline connected successfully. Awaiting test traces." }
          ]);
        }
      }
    } catch (error) {
      console.error("Failed to sync automated CI metrics from Appwrite DB:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLivePipelineData();
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 mb-12">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-[var(--accent-primary)] rounded-2xl flex items-center justify-center text-white shadow-xl shadow-[var(--accent-primary)]/20">
            <TestTube2 className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tighter uppercase italic">Test Results</h1>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.2em] mt-1 italic font-mono">Unit & Integration Matrix</p>
          </div>
        </div>
        
        <button
          onClick={fetchLivePipelineData}
          disabled={loading}
          className="btn-premium flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'SYNCING...' : 'REFRESH'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="p-6 flex flex-col justify-center group hover:border-[var(--accent-primary)] transition-colors premium-card relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <TerminalSquare className="w-24 h-24" />
          </div>
          <p className="text-[10px] font-black text-[var(--text-primary)] uppercase tracking-widest italic mb-2 relative z-10">Test Executions</p>
          <p className="text-4xl font-black tracking-tighter italic text-[var(--accent-primary)] relative z-10">
            {loading ? <span className="animate-pulse opacity-50">...</span> : metrics.testExecutions}
          </p>
        </div>
        <div className="p-6 flex flex-col justify-center group hover:border-[var(--status-success)] transition-colors premium-card relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <BarChart className="w-24 h-24 text-[var(--status-success)]" />
          </div>
          <p className="text-[10px] font-black text-[var(--text-primary)] uppercase tracking-widest italic mb-2 relative z-10">Avg Code Coverage</p>
          <p className="text-4xl font-black tracking-tighter italic text-[var(--status-success)] relative z-10">
            {loading ? <span className="animate-pulse opacity-50">...</span> : `${metrics.codeCoverage.toFixed(1)}%`}
          </p>
        </div>
        <div className="p-6 flex flex-col justify-center group hover:border-[var(--status-error)] transition-colors premium-card relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <AlertCircle className="w-24 h-24 text-[var(--status-error)]" />
          </div>
          <p className="text-[10px] font-black text-[var(--text-primary)] uppercase tracking-widest italic mb-2 relative z-10">Total Failed Tests</p>
          <p className="text-4xl font-black tracking-tighter italic text-[var(--status-error)] relative z-10">
            {loading ? <span className="animate-pulse opacity-50">...</span> : metrics.failedTests}
          </p>
        </div>
      </div>

      <div className="premium-card overflow-hidden">
        <div className="px-10 py-8 border-b border-[var(--border-subtle)] bg-white/5 dark:bg-white/10 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-black text-[var(--text-primary)] uppercase italic tracking-tight">CI Test Output</h2>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-1 italic font-mono">Build Flagging System</p>
          </div>
        </div>

        <div className="bg-zinc-950/80 p-6 font-mono text-xs overflow-y-auto max-h-[500px]">
          <div className="flex flex-col gap-2">
            {loading ? (
              <div className="text-white/40 font-mono text-xs animate-pulse p-4 text-center">Polling live Appwrite telemetry pipelines...</div>
            ) : logs.length === 0 ? (
              <div className="text-white/40 font-mono text-xs p-4 text-center">No telemetry logs found for the current build phase.</div>
            ) : (
              logs.map((log) => (
                <div key={log.id} 
                  onClick={() => { setSelectedLog(log); setCopied(false); }}
                  className="cursor-pointer flex flex-col sm:flex-row sm:items-center gap-4 p-3 rounded-lg bg-zinc-900/50 border border-white/5 hover:bg-white/5 transition-all hover:scale-[1.01]"
                >
                  <span className="text-zinc-500 shrink-0 w-20">[{log.timestamp}]</span>
                  <div className="w-24 shrink-0 flex">
                    <span className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest flex items-center justify-center w-full border ${log.status === 'PASSED' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30 shadow-[0_0_10px_rgba(109,184,122,0.15)]' : 'bg-red-500/10 text-red-500 border-red-500/30 shadow-[0_0_10px_rgba(239,68,68,0.15)]'}`}>
                      {log.status}
                    </span>
                  </div>
                  <span className="text-zinc-400 uppercase tracking-widest text-[10px] w-36 shrink-0 font-bold">{log.stage}</span>
                  <span className={`flex-1 ${log.status === 'FAILED' ? 'text-red-400 font-semibold' : 'text-zinc-300'}`}>
                    {log.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="bg-[var(--bg-card)] w-full max-w-2xl rounded-2xl border border-[var(--border-subtle)] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-6 border-b border-[var(--border-subtle)] bg-white/5 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-black text-[var(--text-primary)] uppercase tracking-wider italic flex items-center gap-2">
                  <TerminalSquare className="text-[var(--accent-primary)]" size={20} /> 
                  Test Execution Details
                </h3>
                <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-widest font-mono mt-1">
                  Trace ID: {selectedLog.id} // Stage: {selectedLog.stage}
                </p>
              </div>
              <button 
                onClick={() => setSelectedLog(null)}
                className="p-2 hover:bg-white/5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-sm font-mono"
              >
                [X] CLOSE
              </button>
            </div>

            <div className="flex-1 p-6 overflow-y-auto bg-zinc-950/90 font-mono text-[11px] text-zinc-300">
              <div className="mb-4 flex justify-between items-center bg-white/5 p-3 rounded-xl border border-white/5">
                <div>
                  <span className="text-zinc-500 uppercase tracking-widest text-[8px] font-bold block mb-1">Status Badge:</span>
                  <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border ${
                    selectedLog.status === 'PASSED' 
                      ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' 
                      : 'bg-red-500/10 text-red-500 border-red-500/30'
                  }`}>
                    {selectedLog.status}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500 uppercase tracking-widest text-[8px] font-bold block mb-1">Timestamp:</span>
                  <span className="text-[10px] text-zinc-300 font-bold">{selectedLog.timestamp}</span>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(selectedLog, null, 2));
                    setCopied(true);
                    toast.success('Copied payload to clipboard');
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="px-3 py-1.5 bg-[var(--accent-primary)]/10 hover:bg-[var(--accent-primary)]/20 border border-[var(--accent-primary)]/30 text-[var(--accent-primary)] text-[9px] font-black uppercase tracking-widest rounded-lg transition-all hover:scale-[1.02]"
                >
                  {copied ? 'COPIED!' : 'COPY PAYLOAD'}
                </button>
              </div>

              <div className="space-y-2">
                <span className="text-zinc-500 uppercase tracking-widest text-[8px] font-bold block">Raw JSON Trace:</span>
                <pre className="p-4 bg-black/60 border border-white/5 rounded-xl overflow-x-auto text-zinc-400 select-all leading-relaxed whitespace-pre-wrap max-h-[350px]">
                  {JSON.stringify(selectedLog, null, 2)}
                </pre>
              </div>
            </div>

            <div className="p-4 bg-white/5 border-t border-[var(--border-subtle)] flex justify-end gap-3">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-5 py-2 bg-[var(--bg-primary)] border border-[var(--border-subtle)] hover:border-zinc-500 text-[10px] font-black uppercase tracking-widest text-[var(--text-primary)] rounded-xl transition-all"
              >
                Back to List
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
