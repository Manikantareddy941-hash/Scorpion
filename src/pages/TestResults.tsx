import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  TestTube2, CheckCircle2, XCircle, AlertCircle, RefreshCw, BarChart, GitBranch, TerminalSquare, ShieldAlert
} from 'lucide-react';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';

export default function TestResults() {
  const { t } = useTranslation();
  const [testRuns, setTestRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTestRuns();
  }, []);

  const fetchTestRuns = async () => {
    try {
      setLoading(true);
      const response = await databases.listDocuments(DB_ID, COLLECTIONS.TEST_RUNS, [
        Query.orderDesc('timestamp'),
        Query.limit(50)
      ]);
      setTestRuns(response.documents || []);
    } catch (err) {
      console.error("Failed to fetch test runs:", err);
    } finally {
      setLoading(false);
    }
  };

  const calculatePassRate = (passed: number, total: number) => {
    if (total === 0) return 0;
    return Math.round((passed / total) * 100);
  };

  const getStatusColor = (status: string) => {
    return status === 'passed' 
      ? 'border-[var(--status-success)]/30 bg-[var(--status-success)]/10 text-[var(--status-success)]'
      : 'border-[var(--status-error)]/30 bg-[var(--status-error)]/10 text-[var(--status-error)]';
  };

  const averageCoverage = testRuns.length > 0 
    ? Math.round(testRuns.reduce((acc, run) => acc + (run.coverage || 0), 0) / testRuns.length)
    : 0;
    
  const totalFailed = testRuns.reduce((acc, run) => acc + (run.failed_tests || 0), 0);

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
          onClick={fetchTestRuns}
          disabled={loading}
          className="btn-premium flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="p-6 flex flex-col justify-center group hover:border-[var(--accent-primary)] transition-colors premium-card relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <TerminalSquare className="w-24 h-24" />
          </div>
          <p className="text-[10px] font-black text-[var(--text-primary)] uppercase tracking-widest italic mb-2 relative z-10">Test Executions</p>
          <p className="text-4xl font-black tracking-tighter italic text-[var(--accent-primary)] relative z-10">{testRuns.length}</p>
        </div>
        <div className="p-6 flex flex-col justify-center group hover:border-[var(--status-success)] transition-colors premium-card relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <BarChart className="w-24 h-24 text-[var(--status-success)]" />
          </div>
          <p className="text-[10px] font-black text-[var(--text-primary)] uppercase tracking-widest italic mb-2 relative z-10">Avg Code Coverage</p>
          <p className="text-4xl font-black tracking-tighter italic text-[var(--status-success)] relative z-10">{averageCoverage}%</p>
        </div>
        <div className="p-6 flex flex-col justify-center group hover:border-[var(--status-error)] transition-colors premium-card relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <AlertCircle className="w-24 h-24 text-[var(--status-error)]" />
          </div>
          <p className="text-[10px] font-black text-[var(--text-primary)] uppercase tracking-widest italic mb-2 relative z-10">Total Failed Tests</p>
          <p className="text-4xl font-black tracking-tighter italic text-[var(--status-error)] relative z-10">{totalFailed}</p>
        </div>
      </div>

      <div className="premium-card overflow-hidden">
        <div className="px-10 py-8 border-b border-[var(--border-subtle)] bg-white/5 dark:bg-white/10 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-black text-[var(--text-primary)] uppercase italic tracking-tight">CI Test Output</h2>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-1 italic font-mono">Build Flagging System</p>
          </div>
        </div>

        <div className="divide-y divide-[var(--border-subtle)]">
          {loading && testRuns.length === 0 ? (
            <div className="p-16 flex justify-center">
              <RefreshCw className="w-8 h-8 animate-spin text-[var(--text-secondary)]" />
            </div>
          ) : testRuns.length === 0 ? (
            <div className="p-16 text-center text-[var(--text-secondary)] text-sm font-bold uppercase tracking-widest italic">
              No test data synced. Send reports to POST /tests/report.
            </div>
          ) : (
            testRuns.map((run) => (
              <div key={run.$id} className="p-8 hover:bg-white/5 transition-all group relative">
                {run.status === 'passed' && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--status-success)]" />
                )}
                {run.status === 'failed' && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--status-error)] animate-pulse" />
                )}
                
                <div className="flex flex-col md:flex-row gap-8 items-start md:items-center justify-between">
                  
                  <div className="flex items-center gap-6">
                    <div className="flex-shrink-0">
                      <div className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center border ${getStatusColor(run.status)}`}>
                        <span className="text-[10px] font-black uppercase tracking-widest">Pass</span>
                        <span className="text-sm font-black">{calculatePassRate(run.passed_tests, run.total_tests)}%</span>
                      </div>
                    </div>
                    
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="font-mono text-xs font-bold text-[var(--text-primary)] bg-[var(--bg-primary)] px-2 py-1 rounded border border-[var(--border-subtle)] flex items-center gap-2">
                          <GitBranch className="w-3 h-3" /> {run.repo_name}
                        </span>
                        <span className={`flex items-center gap-1 text-[9px] font-black uppercase tracking-widest italic border px-2 py-1 rounded-full ${getStatusColor(run.status)}`}>
                          {run.status === 'passed' ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />} {run.status}
                        </span>
                        {run.status === 'failed' && (
                          <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest italic text-[var(--status-warning)] border border-[var(--status-warning)]/30 px-2 py-1 rounded-full bg-[var(--status-warning)]/10">
                            <ShieldAlert className="w-3 h-3" /> Security Scan Skipped
                          </span>
                        )}
                      </div>
                      
                      <h3 className="text-md font-bold text-[var(--text-secondary)] mb-1 font-mono">
                        Build ID: {run.build_id}
                      </h3>
                      
                      <div className="flex flex-wrap gap-4 text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] italic mt-3">
                        <span className="flex items-center gap-1 text-[var(--text-primary)]">
                          Total: {run.total_tests}
                        </span>
                        <span className="flex items-center gap-1 text-[var(--status-success)]">
                          Passed: {run.passed_tests}
                        </span>
                        {run.failed_tests > 0 && (
                          <span className="flex items-center gap-1 text-[var(--status-error)]">
                            Failed: {run.failed_tests}
                          </span>
                        )}
                        {run.skipped_tests > 0 && (
                          <span className="flex items-center gap-1 text-[var(--status-warning)]">
                            Skipped: {run.skipped_tests}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <div className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic">Code Coverage</div>
                    <div className="flex items-center gap-3 w-48">
                      <div className="flex-1 h-2 bg-[var(--bg-primary)] rounded-full overflow-hidden border border-[var(--border-subtle)]">
                        <div 
                          className="h-full bg-[var(--accent-primary)] transition-all"
                          style={{ width: `${run.coverage}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono font-bold text-[var(--text-primary)]">{run.coverage}%</span>
                    </div>
                  </div>

                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
