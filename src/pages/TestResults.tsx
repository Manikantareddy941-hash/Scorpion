import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  TestTube2, CheckCircle2, XCircle, AlertCircle, RefreshCw,
  BarChart, TerminalSquare, TrendingUp, TrendingDown, Minus,
  Filter, Clock, Zap, GitCommit, ChevronDown, ChevronRight,
  Copy, Check, AlertTriangle, Activity
} from 'lucide-react';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import toast from 'react-hot-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TestSuite {
  id: string;
  name: string;
  type: 'unit' | 'integration' | 'e2e' | 'sast' | 'dast';
  status: 'PASSED' | 'FAILED' | 'FLAKY' | 'SKIPPED';
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number; // ms
  coverage?: number;
  flaky?: number;
  failedTests?: FailedTest[];
}

interface FailedTest {
  name: string;
  file: string;
  error: string;
  duration: number;
}

interface LogEntry {
  id: string;
  timestamp: string;
  stage: string;
  status: 'PASSED' | 'FAILED' | 'WARN' | 'INFO';
  message: string;
  duration?: number;
}

interface RunMetrics {
  testExecutions: number;
  codeCoverage: number;
  failedTests: number;
  passRate: number;
  totalDuration: number;
  flaky: number;
  prevCoverage: number;
  prevPassRate: number;
  commitSha: string;
  branch: string;
  triggeredBy: string;
  runAt: string;
}

type LogFilter = 'ALL' | 'PASSED' | 'FAILED' | 'WARN';
type SuiteFilter = 'ALL' | 'unit' | 'integration' | 'e2e' | 'sast' | 'dast';

// ─── Empty defaults (shown until a real test_runs document is fetched) ───────

const EMPTY_METRICS: RunMetrics = {
  testExecutions: 0, codeCoverage: 0, failedTests: 0,
  passRate: 0, totalDuration: 0, flaky: 0,
  prevCoverage: 0, prevPassRate: 0,
  commitSha: '—', branch: '—', triggeredBy: '—', runAt: '—',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;

const suiteTypeColor: Record<string, string> = {
  unit: 'bg-blue-50 text-blue-600 border-blue-200',
  integration: 'bg-purple-50 text-purple-600 border-purple-200',
  e2e: 'bg-orange-50 text-orange-600 border-orange-200',
  sast: 'bg-red-50 text-red-600 border-red-200',
  dast: 'bg-yellow-50 text-yellow-600 border-yellow-200',
};

const statusColor: Record<string, string> = {
  PASSED: 'text-[#6db87a]',
  FAILED: 'text-red-500',
  FLAKY: 'text-orange-500',
  SKIPPED: 'text-slate-400',
};

const logStatusStyle: Record<string, string> = {
  PASSED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  FAILED: 'bg-red-500/10 text-red-400 border-red-500/30',
  WARN: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  INFO: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
};

const Trend = ({ current, prev, suffix = '' }: { current: number; prev: number; suffix?: string }) => {
  const delta = current - prev;
  if (Math.abs(delta) < 0.1) return <span className="text-slate-400 text-[10px] font-bold flex items-center gap-0.5"><Minus size={10} /> No change</span>;
  const up = delta > 0;
  return (
    <span className={`text-[10px] font-bold flex items-center gap-0.5 ${up ? 'text-[#6db87a]' : 'text-red-400'}`}>
      {up ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {up ? '+' : ''}{delta.toFixed(1)}{suffix} vs last run
    </span>
  );
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function TestResults() {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState<RunMetrics>(EMPTY_METRICS);
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasData, setHasData] = useState(false);
  const [expandedSuite, setExpandedSuite] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState<LogFilter>('ALL');
  const [suiteFilter, setSuiteFilter] = useState<SuiteFilter>('ALL');
  const [copied, setCopied] = useState<string | null>(null);

  const fetchLivePipelineData = async () => {
    try {
      setLoading(true);
      const response = await databases.listDocuments(DB_ID, COLLECTIONS.TEST_RUNS, [
        Query.orderDesc('$createdAt'),
        Query.limit(1)
      ]);
      if (response.documents.length > 0) {
        const r = response.documents[0];
        setMetrics({
          testExecutions: r.total_tests || 0,
          codeCoverage: r.coverage || 0,
          failedTests: r.failed_tests || 0,
          passRate: r.pass_rate || 0,
          totalDuration: r.duration_ms || 0,
          flaky: r.flaky_count || 0,
          prevCoverage: r.prev_coverage || 0,
          prevPassRate: r.prev_pass_rate || 0,
          commitSha: r.commit_sha || '—',
          branch: r.branch || '—',
          triggeredBy: r.triggered_by || '—',
          runAt: r.$createdAt ? new Date(r.$createdAt).toLocaleString() : '—',
        });
        let parsedSuites: TestSuite[] = [];
        let parsedLogs: LogEntry[] = [];
        if (r.suitesJson) { try { parsedSuites = JSON.parse(r.suitesJson); } catch { } }
        if (r.logsJson) { try { parsedLogs = JSON.parse(r.logsJson); } catch { } }
        setSuites(parsedSuites);
        setLogs(parsedLogs);
        setHasData(true);
      } else {
        setMetrics(EMPTY_METRICS);
        setSuites([]);
        setLogs([]);
        setHasData(false);
      }
    } catch (err) {
      console.error('Failed to fetch test run:', err);
      toast.error('Failed to load test results');
      setHasData(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLivePipelineData(); }, []);

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(null), 2000);
  };

  const filteredLogs = logFilter === 'ALL' ? logs : logs.filter(l => l.status === logFilter);
  const filteredSuites = suiteFilter === 'ALL' ? suites : suites.filter(s => s.type === suiteFilter);

  const gateBlocked = metrics.failedTests > 0;

  return (
    <div className="max-w-full px-6 py-12 bg-[#f5f0e8] min-h-screen font-mono">

      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 mb-10">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-[#6db87a] rounded-2xl flex items-center justify-center text-white shadow-lg">
            <TestTube2 className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-slate-800 tracking-tighter uppercase italic">Test Results</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-1 italic">Unit · Integration · E2E · SAST · DAST</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Release gate pill */}
          <div className={`px-4 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest flex items-center gap-2 ${gateBlocked
              ? 'bg-red-50 border-red-200 text-red-600'
              : 'bg-[#6db87a]/10 border-[#6db87a]/30 text-[#6db87a]'
            }`}>
            {gateBlocked ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
            Release Gate: {gateBlocked ? 'BLOCKED' : 'CLEAR'}
          </div>
          <button
            onClick={fetchLivePipelineData}
            disabled={loading}
            className="px-5 py-2.5 bg-[#6db87a] hover:bg-[#6db87a]/90 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Syncing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Run context bar ── */}
      <div className="bg-white border border-[#e8e0d0] rounded-xl px-5 py-3 mb-8 flex flex-wrap gap-x-8 gap-y-1 text-[9px] font-mono font-bold text-slate-400 uppercase tracking-widest">
        <span><span className="text-slate-600">Branch:</span> {metrics.branch}</span>
        <span><span className="text-slate-600">Commit:</span> {metrics.commitSha}</span>
        <span><span className="text-slate-600">Triggered by:</span> {metrics.triggeredBy}</span>
        <span><span className="text-slate-600">Run at:</span> {metrics.runAt}</span>
        <span><span className="text-slate-600">Duration:</span> {fmt(metrics.totalDuration)}</span>
      </div>

      {/* ── 6 Metric Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-10">
        {[
          { label: 'Tests Run', value: metrics.testExecutions, color: 'text-blue-500', icon: <TerminalSquare size={16} />, trend: null },
          { label: 'Pass Rate', value: `${metrics.passRate.toFixed(1)}%`, color: 'text-[#6db87a]', icon: <CheckCircle2 size={16} />, trend: <Trend current={metrics.passRate} prev={metrics.prevPassRate} suffix="%" /> },
          { label: 'Coverage', value: `${metrics.codeCoverage.toFixed(1)}%`, color: 'text-[#6db87a]', icon: <BarChart size={16} />, trend: <Trend current={metrics.codeCoverage} prev={metrics.prevCoverage} suffix="%" /> },
          { label: 'Failed', value: metrics.failedTests, color: metrics.failedTests > 0 ? 'text-red-500' : 'text-slate-400', icon: <XCircle size={16} />, trend: null },
          { label: 'Flaky', value: metrics.flaky, color: metrics.flaky > 0 ? 'text-orange-500' : 'text-slate-400', icon: <AlertTriangle size={16} />, trend: null },
          { label: 'Duration', value: fmt(metrics.totalDuration), color: 'text-purple-500', icon: <Clock size={16} />, trend: null },
        ].map(card => (
          <div key={card.label} className="bg-white border border-[#e8e0d0] rounded-xl p-4 flex flex-col gap-1 shadow-sm">
            <div className="flex items-center justify-between text-slate-300 mb-1">{card.icon}</div>
            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{card.label}</p>
            <p className={`text-2xl font-black tracking-tighter ${card.color}`}>{loading ? '…' : card.value}</p>
            {card.trend && <div className="mt-1">{card.trend}</div>}
          </div>
        ))}
      </div>

      {/* ── Suite Breakdown ── */}
      <div className="bg-white border border-[#e8e0d0] rounded-xl overflow-hidden mb-8 shadow-sm">
        <div className="px-6 py-4 border-b border-[#e8e0d0] flex flex-wrap justify-between items-center gap-3 bg-[#f5f0e8]/40">
          <div>
            <h2 className="text-sm font-black text-slate-700 uppercase italic tracking-tight">Test Suite Breakdown</h2>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Click a suite to expand failed tests</p>
          </div>
          {/* Suite type filter */}
          <div className="flex gap-1.5 flex-wrap">
            {(['ALL', 'unit', 'integration', 'e2e', 'sast', 'dast'] as SuiteFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setSuiteFilter(f)}
                className={`px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest border transition-all cursor-pointer ${suiteFilter === f
                    ? 'bg-slate-800 text-white border-slate-700'
                    : 'bg-white text-slate-500 border-[#e8e0d0] hover:border-slate-300'
                  }`}
              >{f}</button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-[#e8e0d0]">
          {!hasData && filteredSuites.length === 0 ? (
            <div className="text-center py-12 text-[10px] font-bold text-slate-400 uppercase tracking-widest italic">
              No test runs recorded yet
            </div>
          ) : filteredSuites.length === 0 ? (
            <div className="text-center py-12 text-[10px] font-bold text-slate-400 uppercase tracking-widest italic">
              No suites matching filter
            </div>
          ) : filteredSuites.map(suite => {
            const isOpen = expandedSuite === suite.id;
            const passWidth = suite.total > 0 ? (suite.passed / suite.total) * 100 : 0;
            return (
              <div key={suite.id}>
                <button
                  onClick={() => setExpandedSuite(isOpen ? null : suite.id)}
                  className="w-full px-6 py-4 flex items-center gap-4 hover:bg-[#f5f0e8]/50 transition-colors text-left cursor-pointer"
                >
                  {/* Expand arrow */}
                  <span className="text-slate-300 shrink-0">
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>

                  {/* Suite name + type badge */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-black text-slate-700 uppercase italic truncate">{suite.name}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[7px] font-black uppercase tracking-widest border shrink-0 ${suiteTypeColor[suite.type]}`}>{suite.type}</span>
                      {suite.flaky! > 0 && (
                        <span className="px-1.5 py-0.5 rounded text-[7px] font-black uppercase tracking-widest border bg-orange-50 text-orange-500 border-orange-200 shrink-0">
                          {suite.flaky} flaky
                        </span>
                      )}
                    </div>
                    {/* Progress bar */}
                    <div className="w-full bg-[#e8e0d0] h-1.5 rounded-full overflow-hidden">
                      <div className="h-full bg-[#6db87a] rounded-full transition-all" style={{ width: `${passWidth}%` }} />
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-6 shrink-0 text-[10px] font-black uppercase">
                    <span className="text-[#6db87a]">{suite.passed}✓</span>
                    {suite.failed > 0 && <span className="text-red-500">{suite.failed}✗</span>}
                    {suite.skipped > 0 && <span className="text-slate-400">{suite.skipped} skip</span>}
                    {suite.coverage !== undefined && <span className="text-blue-500">{suite.coverage}%</span>}
                    <span className="text-slate-400">{fmt(suite.duration)}</span>
                    <span className={`w-14 text-center ${statusColor[suite.status]}`}>{suite.status}</span>
                  </div>
                </button>

                {/* Expanded failed tests */}
                {isOpen && suite.failedTests && suite.failedTests.length > 0 && (
                  <div className="bg-red-50/50 border-t border-red-100 px-6 py-4 space-y-3">
                    <p className="text-[8px] font-black text-red-400 uppercase tracking-widest mb-2">Failed Test Cases</p>
                    {suite.failedTests.map((ft, i) => (
                      <div key={i} className="bg-white border border-red-100 rounded-xl p-4">
                        <div className="flex justify-between items-start gap-4 mb-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-black text-slate-700 uppercase italic mb-1 truncate">{ft.name}</p>
                            <p className="text-[9px] text-blue-500 font-mono font-bold">{ft.file}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[8px] text-slate-400 font-mono">{fmt(ft.duration)}</span>
                            <button
                              onClick={() => copyText(ft.error, `ft-${i}`)}
                              className="p-1.5 bg-[#f5f0e8] border border-[#e8e0d0] rounded-lg text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                            >
                              {copied === `ft-${i}` ? <Check size={10} className="text-[#6db87a]" /> : <Copy size={10} />}
                            </button>
                          </div>
                        </div>
                        {/* Error message — monospace, distinct bg */}
                        <div className="bg-slate-800 rounded-lg px-3 py-2">
                          <p className="text-[9px] font-mono text-red-300 leading-relaxed">{ft.error}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {isOpen && (!suite.failedTests || suite.failedTests.length === 0) && (
                  <div className="bg-[#6db87a]/5 border-t border-[#6db87a]/20 px-6 py-3 text-[9px] font-bold text-[#6db87a] uppercase tracking-widest flex items-center gap-2">
                    <CheckCircle2 size={12} /> All tests in this suite passed.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── CI Log Terminal ── */}
      <div className="bg-white border border-[#e8e0d0] rounded-xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-[#e8e0d0] flex flex-wrap justify-between items-center gap-3 bg-[#f5f0e8]/40">
          <div>
            <h2 className="text-sm font-black text-slate-700 uppercase italic tracking-tight flex items-center gap-2">
              <Activity size={14} className="text-[#6db87a] animate-pulse" />
              CI Pipeline Log
            </h2>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Ordered stage-by-stage execution trace</p>
          </div>
          {/* Log filter */}
          <div className="flex gap-1.5">
            {(['ALL', 'PASSED', 'FAILED', 'WARN'] as LogFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setLogFilter(f)}
                className={`px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest border transition-all cursor-pointer ${logFilter === f
                    ? 'bg-slate-800 text-white border-slate-700'
                    : 'bg-white text-slate-500 border-[#e8e0d0] hover:border-slate-300'
                  }`}
              >{f}</button>
            ))}
          </div>
        </div>

        <div className="bg-slate-900 p-5 font-mono text-xs overflow-y-auto max-h-[400px]">
          {loading ? (
            <div className="text-slate-500 animate-pulse text-center py-8">Polling pipeline telemetry…</div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-slate-500 text-center py-8">{hasData ? 'No entries matching filter.' : 'No pipeline log recorded yet.'}</div>
          ) : (
            <div className="space-y-1.5">
              {filteredLogs.map(log => (
                <div key={log.id} className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-800/50 border border-white/5 hover:border-white/10 transition-all group">
                  <span className="text-slate-500 shrink-0 w-18 text-[9px] mt-0.5">[{log.timestamp}]</span>
                  <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest border shrink-0 ${logStatusStyle[log.status]}`}>
                    {log.status}
                  </span>
                  <span className="text-slate-500 uppercase tracking-widest text-[8px] w-28 shrink-0 font-bold mt-0.5">{log.stage}</span>
                  <span className={`flex-1 text-[10px] leading-relaxed ${log.status === 'FAILED' ? 'text-red-300' :
                      log.status === 'WARN' ? 'text-orange-300' :
                        log.status === 'PASSED' ? 'text-slate-200' : 'text-slate-400'
                    }`}>
                    {log.message}
                  </span>
                  {log.duration !== undefined && (
                    <span className="text-slate-600 text-[8px] shrink-0 mt-0.5 group-hover:text-slate-400 transition-colors">{fmt(log.duration)}</span>
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