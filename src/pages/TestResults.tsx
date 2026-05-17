import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  TestTube2, CheckCircle2, XCircle, AlertCircle, RefreshCw, BarChart, GitBranch, TerminalSquare, ShieldAlert
} from 'lucide-react';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';

export default function TestResults() {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState({ testExecutions: 0, codeCoverage: 0, failedTests: 0 });
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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
                <div key={log.id} className="flex flex-col sm:flex-row sm:items-center gap-4 p-3 rounded-lg bg-zinc-900/50 border border-white/5 hover:bg-white/5 transition-colors">
                  <span className="text-zinc-500 shrink-0 w-20">[{log.timestamp}]</span>
                  <div className="w-24 shrink-0 flex">
                    <span className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest flex items-center justify-center w-full border ${log.status === 'PASSED' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.15)]' : 'bg-red-500/10 text-red-500 border-red-500/30 shadow-[0_0_10px_rgba(239,68,68,0.15)]'}`}>
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
    </div>
  );
}
