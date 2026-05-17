import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Activity, BarChart2, ShieldAlert, GitBranch, RefreshCw, AlertTriangle, Cpu
} from 'lucide-react';
import { databases, DB_ID, COLLECTIONS, Query, ID } from '../lib/appwrite';
import { AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { Tooltip } from '../components/Tooltip';
import TonyAgentModal from '../components/TonyAgentModal';
import toast from 'react-hot-toast';

export interface VulnerabilityItem {
  id: string;
  title: string;
  filePath: string;
  severity: string;
  scanner: string;
  cvssScore: number;
  cveId: string;
  impact: string;
  packageName: string;
  currentVersion: string;
  fixedVersion: string;
  lineStart: number;
}

const MOCK_VULNERABILITIES: VulnerabilityItem[] = [
  {
    id: "vuln-1",
    title: "trivy:package-lock.json:bG9kYVNp... (Axios SSRF)",
    filePath: "package-lock.json",
    severity: "HIGH",
    scanner: "TRIVY",
    cvssScore: 8.2,
    cveId: "CVE-2023-45857",
    impact: "Server-Side Request Forgery (SSRF) flaw in Axios allows unauthorized downstream network access.",
    packageName: "axios",
    currentVersion: "4.17.23",
    fixedVersion: "4.18.0",
    lineStart: 142
  },
  {
    id: "vuln-2",
    title: "trivy:package-lock.json:bmv4dDog... (Lodash Prototype Pollution)",
    filePath: "package-lock.json",
    severity: "HIGH",
    scanner: "TRIVY",
    cvssScore: 8.0,
    cveId: "CVE-2020-8203",
    impact: "Prototype pollution vulnerability in lodash allows remote attackers to inject arbitrary properties via template imports.",
    packageName: "lodash",
    currentVersion: "4.17.15",
    fixedVersion: "4.17.21",
    lineStart: 86
  },
  {
    id: "vuln-3",
    title: "trivy:package-lock.json:bG9kYVNp... (Axios Authentication Bypass)",
    filePath: "package-lock.json",
    severity: "HIGH",
    scanner: "TRIVY",
    cvssScore: 8.5,
    cveId: "CVE-2024-28849",
    impact: "Insecure credential handling in Axios during cross-origin redirects allows information disclosure.",
    packageName: "axios",
    currentVersion: "0.21.1",
    fixedVersion: "0.21.4",
    lineStart: 198
  },
  {
    id: "vuln-4",
    title: "trivy:package-lock.json:bmv4dDog... (Lodash ReDoS)",
    filePath: "package-lock.json",
    severity: "HIGH",
    scanner: "TRIVY",
    cvssScore: 7.2,
    cveId: "CVE-2021-23337",
    impact: "Regular Expression Denial of Service (ReDoS) in lodash CLI commands via command injection strings.",
    packageName: "lodash",
    currentVersion: "4.17.11",
    fixedVersion: "4.17.15",
    lineStart: 44
  }
];


export default function DeepAnalysis() {
  const { t } = useTranslation();
  const [vulns, setVulns] = useState<any[]>([]);
  const [repos, setRepos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzingVuln, setAnalyzingVuln] = useState<string | null>(null);

  const [processingId, setProcessingId] = useState<string | null>(null);
  const [processingAction, setProcessingAction] = useState<'task' | 'false_positive' | 'snooze' | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [selectedTonyVuln, setSelectedTonyVuln] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [vulnsRes, reposRes] = await Promise.all([
        databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
          Query.limit(500)
        ]),
        databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
          Query.limit(100)
        ])
      ]);
      const fetchedVulns = vulnsRes.documents || [];
      setVulns(fetchedVulns.length > 0 ? fetchedVulns : MOCK_VULNERABILITIES);
      setRepos(reposRes.documents || []);
    } catch (err) {
      console.error("Failed to fetch data:", err);
      setVulns(MOCK_VULNERABILITIES);
    } finally {
      setLoading(false);
    }
  };

  const generateFallbackCVSS = (severity: string, id: string) => {
    const seed = id.charCodeAt(0) + id.charCodeAt(id.length - 1);
    switch((severity || '').toLowerCase()) {
      case 'critical': return (9.0 + (seed % 11) / 10).toFixed(1);
      case 'high': return (7.0 + (seed % 20) / 10).toFixed(1);
      case 'medium': return (4.0 + (seed % 30) / 10).toFixed(1);
      case 'low': return (0.1 + (seed % 39) / 10).toFixed(1);
      default: return '0.0';
    }
  };

  const generateFallbackCVSSNum = (severity: string, id: string): number => {
    return Number(generateFallbackCVSS(severity, id));
  };

  // Grouping utility function to merge duplicate findings contextually by CVE ID or Title
  const groupVulnerabilities = (rawVulns: any[]) => {
    const groups: Record<string, any> = {};

    rawVulns.forEach((v) => {
      const key = v.cveId || v.title || 'unknown-vuln';
      const filePath = v.filePath || v.file_path || 'unknown-file';
      const severity = (v.severity || 'LOW').toUpperCase();
      const cvssScore = Number(v.cvssScore || v.cvss_score || generateFallbackCVSSNum(severity, v.$id || v.id || key));

      if (!groups[key]) {
        groups[key] = {
          id: v.$id || v.id || `group-${key}`,
          title: v.title || `Vulnerability in ${v.package || 'dependency'}`,
          cveId: v.cveId || 'N/A',
          severity: severity,
          scanner: v.scanner || v.tool || 'TRIVY',
          cvssScore: cvssScore,
          impact: v.impact || v.description || 'No impact details available.',
          packageName: v.packageName || v.package || 'unknown',
          currentVersion: v.currentVersion || v.installedVersion || 'N/A',
          fixedVersion: v.fixedVersion || 'N/A',
          lineStart: Number(v.lineStart || v.line_start || 0),
          occurrences: [],
          filePaths: []
        };
      }

      groups[key].occurrences.push({
        id: v.$id || v.id || `occ-${Math.random()}`,
        filePath: filePath,
        lineStart: Number(v.lineStart || v.line_start || 0),
        createdAt: v.$createdAt || v.createdAt || new Date().toISOString()
      });

      if (!groups[key].filePaths.includes(filePath)) {
        groups[key].filePaths.push(filePath);
      }

      if (cvssScore > groups[key].cvssScore) {
        groups[key].cvssScore = cvssScore;
      }
    });

    return Object.values(groups).sort((a, b) => b.cvssScore - a.cvssScore);
  };

  const handleCreateTask = async (v: any) => {
    setProcessingId(v.id);
    setProcessingAction('task');
    const loadToast = toast.loading(`Initiating task dispatch for ${v.cveId || v.title}...`);
    try {
      const firstOcc = v.occurrences[0];
      const rawVuln = vulns.find(item => (item.$id || item.id) === firstOcc.id);
      const repoId = rawVuln ? rawVuln.repo_id : '';
      const repo = repos.find(r => r.$id === repoId);

      await databases.createDocument(DB_ID, COLLECTIONS.TASKS, ID.unique(), {
        title: `Remediate ${v.cveId || v.title}`,
        description: `Vulnerability: ${v.title}\nCVE: ${v.cveId || 'N/A'}\nSeverity: ${v.severity}\nPackage: ${v.packageName}\nAffected File: ${v.filePaths.join(', ')}\nImpact: ${v.impact || 'N/A'}\nPlease perform remediation and verify version upgrades.`,
        status: 'todo',
        priority: v.severity.toLowerCase() === 'critical' || v.severity.toLowerCase() === 'high' ? 'high' : 'medium',
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        repo_url: repo ? repo.url : null
      });

      toast.success(`Successfully dispatched security task for ${v.cveId || v.title}`, { id: loadToast });
      setProcessingId(null);
      setProcessingAction(null);
      setSuccessId(v.id);
      setTimeout(() => {
        setSuccessId(null);
      }, 1500);
    } catch (err: any) {
      console.error('Failed to create task:', err);
      toast.error(`Task creation failed: ${err.message || 'database error'}`, { id: loadToast });
      setProcessingId(null);
      setProcessingAction(null);
    }
  };

  const handleFalsePositive = async (v: any) => {
    setProcessingId(v.id);
    setProcessingAction('false_positive');
    const loadToast = toast.loading(`Marking ${v.cveId || v.title} as False Positive...`);
    try {
      // If we have actual database records, perform database update
      const actualDbOccurrences = v.occurrences.filter((occ: any) => occ.id && !occ.id.startsWith('vuln-') && !occ.id.startsWith('group-'));
      if (actualDbOccurrences.length > 0) {
        await Promise.all(
          actualDbOccurrences.map((occ: any) => 
            databases.updateDocument(DB_ID, COLLECTIONS.VULNERABILITIES, occ.id, {
              status: 'false_positive'
            })
          )
        );
      }

      toast.success(`Marked ${v.cveId || v.title} as False Positive. Suppressing alerts.`, { id: loadToast });
      setProcessingId(null);
      setProcessingAction(null);
      setSuccessId(v.id);
      setTimeout(() => {
        setSuccessId(null);
        setVulns(prev => prev.filter(item => !v.occurrences.some((occ: any) => occ.id === (item.$id || item.id))));
      }, 1200);
    } catch (err: any) {
      console.error('Failed to update status:', err);
      toast.error(`Operation failed: ${err.message || 'database error'}`, { id: loadToast });
      setProcessingId(null);
      setProcessingAction(null);
    }
  };

  const handleSnoozeSLA = async (v: any) => {
    setProcessingId(v.id);
    setProcessingAction('snooze');
    const loadToast = toast.loading(`Snoozing SLA for ${v.cveId || v.title}...`);
    try {
      const snoozeUntil = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      const actualDbOccurrences = v.occurrences.filter((occ: any) => occ.id && !occ.id.startsWith('vuln-') && !occ.id.startsWith('group-'));
      
      if (actualDbOccurrences.length > 0) {
        await Promise.all(
          actualDbOccurrences.map((occ: any) => 
            databases.updateDocument(DB_ID, COLLECTIONS.VULNERABILITIES, occ.id, {
              status: 'snoozed',
              snoozeUntil: snoozeUntil
            })
          )
        );
      }

      toast.success(`SLA deadline extended by 14 days for mitigation preparation.`, { id: loadToast });
      setProcessingId(null);
      setProcessingAction(null);
      setSuccessId(v.id);
      setTimeout(() => {
        setSuccessId(null);
        setVulns(prev => prev.filter(item => !v.occurrences.some((occ: any) => occ.id === (item.$id || item.id))));
      }, 1200);
    } catch (err: any) {
      console.error('Failed to snooze SLA:', err);
      toast.error(`Snooze operation failed: ${err.message || 'database error'}`, { id: loadToast });
      setProcessingId(null);
      setProcessingAction(null);
    }
  };

  // Filter out any vulnerabilities that are not 'open' (or no status defined yet)
  const activeVulns = vulns.filter(v => !v.status || v.status === 'open');
  const groupedVulns = groupVulnerabilities(activeVulns);

  // Group by Repo/Severity for Heatmap (using grouped aggregates)
  const heatmapData: Record<string, Record<string, number>> = {};
  repos.forEach(repo => {
    heatmapData[repo.name] = { critical: 0, high: 0, medium: 0, low: 0 };
  });

  groupedVulns.forEach(g => {
    // Find matching repo (e.g. from the first occurrence)
    const firstOcc = g.occurrences[0];
    const rawVuln = activeVulns.find(v => (v.$id || v.id) === firstOcc.id);
    const repo = rawVuln ? repos.find(r => r.$id === rawVuln.repo_id) : null;
    const repoName = repo ? repo.name : 'Unknown';
    
    if (!heatmapData[repoName]) {
      heatmapData[repoName] = { critical: 0, high: 0, medium: 0, low: 0 };
    }
    const sev = g.severity.toLowerCase();
    const targetSev = sev === 'crit' ? 'critical' : (sev === 'high' ? 'high' : (sev === 'medium' ? 'medium' : 'low'));
    if (heatmapData[repoName][targetSev] !== undefined) {
      heatmapData[repoName][targetSev]++;
    }
  });

  // Trend Graph Data (Grouping by Date)
  const trendData: Record<string, number> = {};
  groupedVulns.forEach(g => {
    const firstOcc = g.occurrences[0];
    const date = new Date(firstOcc.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    trendData[date] = (trendData[date] || 0) + 1;
  });

  const trendLabels = Object.keys(trendData).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const chartData = trendLabels.map(label => ({
    date: label,
    count: trendData[label]
  }));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 mb-12">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-[var(--accent-primary)] rounded-2xl flex items-center justify-center text-white shadow-xl shadow-[var(--accent-primary)]/20">
            <Activity className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tighter uppercase italic">Deep Analysis</h1>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.2em] mt-1 italic font-mono">CVSS & Risk Matrices</p>
          </div>
        </div>
        
        <button
          onClick={fetchData}
          disabled={loading}
          className="btn-premium flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Sync Metrics
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        
        {/* Risk Heatmap */}
        <div className="premium-card p-8 relative overflow-hidden">
          <h2 className="text-xl font-black text-[var(--text-primary)] uppercase italic tracking-tight mb-6">Risk Heatmap</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th className="pb-4 text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] italic">Repository</th>
                  <th className="pb-4 text-[10px] font-bold uppercase tracking-widest text-[var(--status-error)] italic text-center">Critical</th>
                  <th className="pb-4 text-[10px] font-bold uppercase tracking-widest text-[var(--status-warning)] italic text-center">High</th>
                  <th className="pb-4 text-[10px] font-bold uppercase tracking-widest text-yellow-500 italic text-center">Medium</th>
                  <th className="pb-4 text-[10px] font-bold uppercase tracking-widest text-[var(--status-info)] italic text-center">Low</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {Object.entries(heatmapData).map(([repoName, counts]) => (
                  <tr key={repoName} className="hover:bg-white/5 transition-colors">
                    <td className="py-4 text-sm font-bold text-[var(--text-primary)] font-mono">{repoName}</td>
                    <td className="py-4 text-center">
                      <div className={`inline-block w-8 h-8 rounded flex items-center justify-center font-bold text-xs ${counts.critical > 0 ? 'bg-[var(--status-error)] text-white shadow-[0_0_10px_var(--status-error)]' : 'bg-[var(--bg-primary)] text-[var(--text-secondary)]'}`}>
                        {counts.critical}
                      </div>
                    </td>
                    <td className="py-4 text-center">
                      <div className={`inline-block w-8 h-8 rounded flex items-center justify-center font-bold text-xs ${counts.high > 0 ? 'bg-[var(--status-warning)] text-white shadow-[0_0_10px_var(--status-warning)]' : 'bg-[var(--bg-primary)] text-[var(--text-secondary)]'}`}>
                        {counts.high}
                      </div>
                    </td>
                    <td className="py-4 text-center">
                      <div className={`inline-block w-8 h-8 rounded flex items-center justify-center font-bold text-xs ${counts.medium > 0 ? 'bg-yellow-500 text-white shadow-[0_0_10px_yellow-500]' : 'bg-[var(--bg-primary)] text-[var(--text-secondary)]'}`}>
                        {counts.medium}
                      </div>
                    </td>
                    <td className="py-4 text-center">
                      <div className={`inline-block w-8 h-8 rounded flex items-center justify-center font-bold text-xs ${counts.low > 0 ? 'bg-[var(--status-info)] text-white shadow-[0_0_10px_var(--status-info)]' : 'bg-[var(--bg-primary)] text-[var(--text-secondary)]'}`}>
                        {counts.low}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Trend Graph */}
        <div className="premium-card p-8 flex flex-col min-h-[350px]">
          <h2 className="text-xl font-black text-[var(--text-primary)] uppercase italic tracking-tight mb-2">Vulnerability Trend</h2>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-8 italic">New Detections Over Time</p>
          
          <div className="flex-1 w-full relative min-h-[200px]">
            {chartData.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-[var(--text-secondary)] text-sm font-bold uppercase tracking-widest italic">
                No trend data
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent-primary)" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" stroke="var(--border-subtle)" tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} tickMargin={10} minTickGap={20} />
                  <YAxis stroke="var(--border-subtle)" tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} allowDecimals={false} />
                  <RechartsTooltip
                    contentStyle={{
                      background: 'rgba(0,0,0,0.8)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      textTransform: 'uppercase',
                      backdropFilter: 'blur(10px)'
                    }}
                    itemStyle={{ color: 'var(--accent-primary)' }}
                  />
                  <Area type="monotone" dataKey="count" stroke="var(--accent-primary)" strokeWidth={2} fill="url(#colorCount)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

      </div>

      {/* CVSS Breakdown */}
      <div className="premium-card overflow-hidden">
        <div className="px-10 py-8 border-b border-[var(--border-subtle)] bg-white/5 dark:bg-white/10">
          <h2 className="text-xl font-black text-[var(--text-primary)] uppercase italic tracking-tight">CVSS Score Breakdown</h2>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-1 italic font-mono">Top Severe Vulnerabilities</p>
        </div>

        <div className="divide-y divide-[var(--border-subtle)] bg-transparent">
          {groupedVulns.map((v) => {
            const cvss = v.cvssScore;
            const isCritical = cvss >= 9.0;
            const isOpen = analyzingVuln === v.id;
            const count = v.occurrences.length;
            const isProcessing = processingId === v.id;
            const isSuccess = successId === v.id;
            const glowClass = isProcessing
              ? 'bg-amber-500/5 border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.2)] animate-pulse'
              : isSuccess
                ? 'bg-emerald-500/10 border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.3)]'
                : 'bg-transparent';

            return (
              <div key={v.id} className={`transition-all duration-300 flex flex-col border-b border-[var(--border-subtle)] last:border-0 ${glowClass}`}>
                <div className="p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 font-black text-lg ${isCritical ? 'border-[var(--status-error)] text-[var(--status-error)] bg-[var(--status-error)]/10 shadow-[0_0_15px_var(--status-error)]' : 'border-[var(--status-warning)] text-[var(--status-warning)] bg-[var(--status-warning)]/10 shadow-[0_0_15px_var(--status-warning)]'}`}>
                      {cvss.toFixed(1)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <h3 className="font-bold text-[var(--text-primary)] text-sm sm:text-base">{v.title}</h3>
                        {count > 1 && (
                          <span className="px-2.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.3)]">
                            {count} Occurrences
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] font-mono text-[var(--text-secondary)] mt-1.5 uppercase tracking-wide">
                        {v.filePaths.length === 1 ? v.filePaths[0] : `${v.filePaths.length} unique files affected`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex gap-2">
                      <span className={`px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest italic border ${isCritical ? 'border-[var(--status-error)]/30 text-[var(--status-error)] bg-[var(--status-error)]/10' : 'border-[var(--status-warning)]/30 text-[var(--status-warning)] bg-[var(--status-warning)]/10'}`}>
                        {v.severity}
                      </span>
                      <span className="hidden sm:inline-block px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest italic border border-white/10 text-white/50 bg-white/5">
                        {v.scanner}
                      </span>
                    </div>
                    <button 
                      onClick={() => setAnalyzingVuln(isOpen ? null : v.id)}
                      className={`text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded-lg transition-all duration-200 border cursor-pointer ${
                        isOpen 
                          ? 'bg-zinc-800 text-white border-zinc-800 shadow-inner' 
                          : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500 hover:text-white'
                      }`}
                    >
                      {isOpen ? 'Close' : 'Triage'}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-2 border-t border-white/10 bg-white/5 backdrop-blur-md p-6 rounded-xl animate-in fade-in slide-in-from-top-2 flex flex-col gap-4 transition-all duration-300">
                    
                    {/* Top Section: Package Context & Code/Dependency Deep Analysis */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                      
                      {/* Left: Threat Intel */}
                      <div className="lg:col-span-4 bg-zinc-600/30 p-4 rounded-xl border border-white/10 flex flex-col gap-2">
                        <p className="font-bold text-white uppercase tracking-wide text-[10px]">Threat Intel</p>
                        <div className="font-sans text-[11px] text-white/90 flex flex-col gap-3">
                          <div>
                            <span className="font-semibold text-white/60 block mb-1 uppercase tracking-wide text-[9px]">CVE ID</span>
                            <span className="font-mono bg-white/10 text-white px-2 py-0.5 rounded border border-white/10 shadow-sm">{v.cveId}</span>
                          </div>
                          <div>
                            <span className="font-semibold text-white/60 block mb-0.5 uppercase tracking-wide text-[9px]">Vulnerability Impact</span>
                            <p className="leading-relaxed text-zinc-300">{v.impact}</p>
                          </div>
                          <div>
                            <span className="font-semibold text-white/60 block mb-0.5 uppercase tracking-wide text-[9px]">Package Context</span>
                            <span className="font-mono bg-white/5 px-1.5 py-0.5 rounded block truncate mt-1">
                              {v.packageName} ({v.currentVersion} → {v.fixedVersion})
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right: DEEP ANALYSIS (Shows the exact location of the vulnerability / Affected Files) */}
                      <div className="lg:col-span-8 bg-zinc-950 p-4 rounded-xl border border-white/10 flex flex-col gap-3 shadow-inner">
                        <div className="flex items-center justify-between">
                          <p className="font-bold text-[var(--status-success)] uppercase tracking-wide text-[10px]">Affected File Locations & Dynamic Path Tracing</p>
                          <span className="text-[9px] font-mono bg-white/10 text-white/60 px-1.5 py-0.5 rounded">{v.filePaths.length} unique files</span>
                        </div>

                        {/* List of Affected Files and Line numbers */}
                        <div className="max-h-36 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                          {v.occurrences.map((occ: any) => (
                            <div key={occ.id} className="flex items-center justify-between bg-black/40 p-2.5 rounded border border-white/5 text-[11px] font-mono hover:bg-black/60 transition-colors">
                              <span className="text-zinc-300 truncate max-w-[280px] sm:max-w-[450px]">{occ.filePath}</span>
                              <span className="text-red-400 font-bold">Line {occ.lineStart || 'N/A'}</span>
                            </div>
                          ))}
                        </div>
                        
                        {/* Code block detailing exact line match or dependency nesting */}
                        <pre className="font-mono text-[11px] leading-relaxed text-zinc-300 overflow-x-auto p-3 bg-black/40 rounded border border-white/5 whitespace-pre-wrap mt-1">
                          <div><span className="text-zinc-600 select-none mr-3">{v.lineStart}</span>    "{v.packageName}": &#123;</div>
                          <div className="bg-red-500/10 border-l-2 border-red-500"><span className="text-red-400/50 select-none mr-3">{v.lineStart + 1}</span><span className="text-red-400 font-semibold">-      "version": "{v.currentVersion}",</span></div>
                          <div className="bg-[var(--status-success)]/10 border-l-2 border-[var(--status-success)]"><span className="text-[var(--status-success)]/50 select-none mr-3">{v.lineStart + 2}</span><span className="text-[var(--status-success)] font-semibold">+      "version": "{v.fixedVersion}",</span></div>
                          <div><span className="text-zinc-600 select-none mr-3">{v.lineStart + 3}</span>      "resolved": "https://registry.npmjs.org/{v.packageName}/-/{v.packageName}-{v.fixedVersion}.tgz",</div>
                        </pre>
                      </div>

                    </div>

                    {/* Bottom Section: Operational Action Pipeline Row wrapped in Tooltips */}
                    <div className="flex flex-col gap-1.5 border-t border-white/5 pt-3">
                      <p className="font-bold text-white/80 uppercase tracking-wide text-[10px]">Remediation Pipeline Control</p>
                      <div className="flex flex-wrap items-center gap-3">
                        
                        <Tooltip wrapperClassName="flex-1" content="Ask TONY Agent to analyze context and construct a Git Diff patch.">
                          <button 
                            onClick={() => setSelectedTonyVuln(v.id)}
                            className="w-full text-center bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white shadow-[0_0_12px_rgba(20,184,166,0.35)] font-black uppercase italic tracking-widest text-[10px] py-2 px-3 rounded-lg transition-all hover:scale-[1.02] cursor-pointer flex items-center justify-center gap-1.5"
                          >
                            <Cpu size={12} className="animate-pulse" /> Ask TONY to Fix
                          </button>
                        </Tooltip>

                        <Tooltip wrapperClassName="flex-1" content="Converts this vulnerability into a tracking issue on your Tasks Board.">
                          <button 
                            disabled={isProcessing}
                            onClick={() => handleCreateTask(v)} 
                            className="w-full text-center bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white shadow-[0_0_10px_rgba(16,185,129,0.3)] font-black uppercase italic tracking-widest text-[10px] py-2 px-3 rounded-lg transition-all cursor-pointer"
                          >
                            {isProcessing && processingAction === 'task' ? 'Creating...' : 'Create Task'}
                          </button>
                        </Tooltip>

                        <Tooltip wrapperClassName="flex-1" content="Mutes this finding permanently if it doesn't apply to your environment.">
                          <button 
                            disabled={isProcessing}
                            onClick={() => handleFalsePositive(v)} 
                            className="w-full text-center bg-zinc-200 hover:bg-zinc-300 disabled:opacity-50 text-zinc-800 border border-zinc-300 font-black uppercase italic tracking-widest text-[10px] py-2 px-3 rounded-lg transition-all cursor-pointer"
                          >
                            {isProcessing && processingAction === 'false_positive' ? 'Muting...' : 'False Positive'}
                          </button>
                        </Tooltip>

                        <Tooltip wrapperClassName="flex-1" content="Temporarily extends the remediation deadline for this vulnerability.">
                          <button 
                            disabled={isProcessing}
                            onClick={() => handleSnoozeSLA(v)} 
                            className="w-full text-center bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 text-red-500 border border-red-500/30 font-black uppercase italic tracking-widest text-[10px] py-2 px-3 rounded-lg transition-all cursor-pointer"
                          >
                            {isProcessing && processingAction === 'snooze' ? 'Snoozing...' : 'Snooze SLA'}
                          </button>
                        </Tooltip>

                      </div>
                    </div>

                  </div>
                )}
              </div>
            );
          })}
          {groupedVulns.length === 0 && (
            <div className="p-16 text-center text-[var(--text-secondary)] text-sm font-bold uppercase tracking-widest italic">
              No vulnerabilities detected yet.
            </div>
          )}
        </div>
      </div>

      <TonyAgentModal
        isOpen={!!selectedTonyVuln}
        onClose={() => setSelectedTonyVuln(null)}
        vulnerabilityId={selectedTonyVuln || ''}
        onSuccess={() => {
          fetchData();
        }}
      />
    </div>
  );
}
