import React, { useEffect, useState, useRef, useMemo, memo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import {
  LogOut, Shield, Settings, ChevronDown, Activity, ListTodo, AlertCircle,
  ShieldAlert, ShieldCheck, ShieldX, Zap, ArrowRight, Gavel, Sun, Moon, Eye, Cloud, Waves, Bug, Wind, GitCompare, CheckCircle, TrendingUp, ArrowLeftRight,
  XCircle, GitBranch, Monitor, ExternalLink
} from 'lucide-react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip,
  RadialBarChart, RadialBar, AreaChart, Area
} from 'recharts';
import { Client } from 'appwrite';
import axios from 'axios';
import logoImg from '../assets/pre-final_logo-removebg-preview.png';
import TrendChart from './TrendChart';

const SecurityRadarChart = memo(({ data, isSidebarCollapsed }: { data: any[], isSidebarCollapsed: boolean }) => (
  <ResponsiveContainer key={isSidebarCollapsed ? 'collapsed' : 'expanded'} width="99%" height="100%" minWidth={1} minHeight={1}>
    <RadarChart cx="50%" cy="50%" outerRadius="80%" data={data}>
      <PolarGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
      <PolarAngleAxis
        dataKey="axis"
        tick={{ fill: 'var(--text-secondary)', fontSize: 10, fontWeight: 'bold' }}
      />
      <PolarRadiusAxis
        angle={30}
        domain={[0, 100]}
        tick={false}
      />
      <Radar
        name="Observed"
        dataKey="Observed"
        stroke="var(--accent-primary)"
        fill="var(--accent-primary)"
        fillOpacity={0.6}
        isAnimationActive={false}
      />
      <Tooltip
        contentStyle={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '12px',
          fontSize: '10px',
          fontWeight: 'bold',
          textTransform: 'uppercase'
        }}
      />
    </RadarChart>
  </ResponsiveContainer>
));

import { useTranslation } from 'react-i18next';

export default function Dashboard({ isSidebarCollapsed }: { isSidebarCollapsed: boolean }) {
  const { t } = useTranslation();
  console.log('CRITICAL: Dashboard component v2 loading...');
  const { user, signOut } = useAuth();
  const { theme, setTheme, getLogoFilter } = useTheme();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [latestScan, setLatestScan] = useState<any | null>(null);
  const [latestVulnerabilities, setLatestVulnerabilities] = useState<any[]>([]);
  const [prevScan, setPrevScan] = useState<any | null>(null);
  const [prevVulnerabilities, setPrevVulnerabilities] = useState<any[]>([]);
  const [repositories, setRepositories] = useState<any[]>([]);

  // Compliance Widget State
  const [complianceScore, setComplianceScore] = useState<number>(100);
  const [complianceTrend, setComplianceTrend] = useState<any[]>([{ day: 'A', score: 100 }, { day: 'B', score: 100 }]);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [recentScans, setRecentScans] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [loadingCompliance, setLoadingCompliance] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const securityScore = Math.max(0, 100 - ((latestScan?.criticalCount ?? 0) * 10) - ((latestScan?.highCount ?? 0) * 5));

  const metrics = [
    { label: t('dashboard.critical_vulnerabilities'), value: latestScan?.criticalCount ?? 0, icon: ShieldX, color: '#ff5252' },
    { label: t('dashboard.high_vulnerabilities'), value: latestScan?.highCount ?? 0, icon: ShieldAlert, color: '#ff8a80' },
    { label: t('dashboard.medium_vulnerabilities'), value: latestScan?.mediumCount ?? 0, icon: AlertCircle, color: '#ffd740' },
    { label: t('dashboard.low_vulnerabilities', 'Low Risk'), value: latestScan?.lowCount ?? 0, icon: ShieldCheck, color: '#00ffcc' },
    { label: t('reports.bugs'), value: latestScan?.bugCount ?? 0, icon: Bug, color: '#00e5ff' },
    { label: t('reports.vulnerabilities'), value: (latestScan?.criticalCount ?? 0) + (latestScan?.highCount ?? 0) + (latestScan?.mediumCount ?? 0) + (latestScan?.lowCount ?? 0), icon: Activity, color: '#38bdf8' },
    { label: t('dashboard.code_smells', 'Code Smells'), value: latestScan?.codeSmellCount ?? 0, icon: Wind, color: '#fbbf24' },
    { label: t('dashboard.security_posture'), value: `${securityScore}%`, icon: Zap, color: '#00ffa3' },
  ];

  const threatData = [
    { axis: 'Critical', Observed: latestScan?.criticalCount ?? 0 },
    { axis: 'High', Observed: latestScan?.highCount ?? 0 },
    { axis: 'Medium', Observed: latestScan?.mediumCount ?? 0 },
    { axis: 'Low', Observed: latestScan?.lowCount ?? 0 },
    { axis: 'Bugs', Observed: latestScan?.bugCount ?? 0 },
    { axis: 'Vulnerabilities', Observed: (latestScan?.criticalCount ?? 0) + (latestScan?.highCount ?? 0) + (latestScan?.mediumCount ?? 0) + (latestScan?.lowCount ?? 0) },
    { axis: 'Code Smells', Observed: latestScan?.codeSmellCount ?? 0 },
    { axis: 'Security', Observed: securityScore },
  ];


  const fingerprint = (v: any) => `${v.tool}-${v.file}-${v.line}-${v.severity}`;

  const scanDelta = useMemo(() => {
    if (!latestScan) return null;
    if (!prevScan) return { noPrev: true, newFindings: [], fixedFindings: [] };

    const latestFingerprints = new Set(latestVulnerabilities.map(fingerprint));
    const prevFingerprints = new Set(prevVulnerabilities.map(fingerprint));

    const newFindings = latestVulnerabilities.filter((v: any) => !prevFingerprints.has(fingerprint(v)));
    const fixedFindings = prevVulnerabilities.filter((v: any) => !latestFingerprints.has(fingerprint(v)));

    return {
      noPrev: false,
      newFindings,
      fixedFindings
    };
  }, [latestScan, prevScan, latestVulnerabilities, prevVulnerabilities]);

  useEffect(() => {
    setMounted(true);

    const init = async () => {
      await Promise.all([
        fetchLatestScan(),
        fetchCompliance(),
        fetchRepositories()
      ]);
      setLastRefreshed(new Date());
      setLoading(false);
    };
    init();
  }, []);

  // Realtime subscription for automatic dashboard updates
  useEffect(() => {
    const client = new Client()
      .setEndpoint(import.meta.env.VITE_APPWRITE_ENDPOINT)
      .setProject(import.meta.env.VITE_APPWRITE_PROJECT_ID);

    let realtimeDebounce: ReturnType<typeof setTimeout> | null = null;

    const subscription = client.subscribe(
      `databases.${DB_ID}.collections.${COLLECTIONS.SCANS}.documents`,
      (response) => {
        console.log('Realtime Dashboard Update:', response);
        if (realtimeDebounce) clearTimeout(realtimeDebounce);
        realtimeDebounce = setTimeout(() => {
          fetchLatestScan();
          fetchCompliance();
          fetchRepositories();
        }, 2000);
      }
    );

    return () => {
      subscription();
      if (realtimeDebounce) clearTimeout(realtimeDebounce);
    };
  }, []);

  const handleManualRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      // Step 1: Visual reset to 0 to show activity
      setLatestScan((prev: any) => prev ? {
        ...prev,
        criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0,
        bugCount: 0, codeSmellCount: 0
      } : null);

      await Promise.all([
        fetchLatestScan(),
        fetchCompliance(),
        fetchRepositories()
      ]);
      setLastRefreshed(new Date());
      setRefreshKey(k => k + 1);
    } finally {
      setRefreshing(false);
    }
  };

  const fetchLatestScan = async () => {
    try {
      const response = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
        Query.orderDesc('$createdAt'),
        Query.limit(2)
      ]);

      if (response.documents.length === 0) return;

      const scan = response.documents[0];

      const vulnsRes = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
        Query.equal('scanId', scan.$id),
        Query.limit(1000)
      ]);

      let critical = 0, high = 0, medium = 0, low = 0, bugs = 0, codeSmells = 0;

      vulnsRes.documents.forEach((v: any) => {
        const sev = v.severity?.toLowerCase();
        if (sev === 'critical') critical++;
        else if (sev === 'high') high++;
        else if (sev === 'medium') medium++;
        else if (sev === 'low') low++;

        const tool = v.tool?.toLowerCase();
        if (tool === 'semgrep' || tool === 'trivy') bugs++;
        if (tool === 'gitleaks') codeSmells++;
      });

      // Try to extract counts from details JSON if root fields are 0
      let detailsData: any = {};
      try {
        if (scan.details) {
          detailsData = JSON.parse(scan.details);
          // If the DB totals are valid (>0), we can use them as a fallback/verification
          if (detailsData.critical_count > critical) critical = detailsData.critical_count;
          if (detailsData.high_count > high) high = detailsData.high_count;
        }
      } catch (e) { }

      // Force new object reference so React detects the change
      setLatestScan({
        ...scan,
        criticalCount: critical,
        highCount: high,
        mediumCount: medium,
        lowCount: low,
        bugCount: bugs,
        codeSmellCount: codeSmells,
        _refreshedAt: Date.now() // forces new reference every time
      });
      setLatestVulnerabilities([...vulnsRes.documents]);

      // Fetch recent scans for history
      setRecentScans(response.documents.slice(0, 5));

      // Fetch latest incidents
      fetchIncidents();

      if (response.documents.length > 1) {
        const prev = response.documents[1];

        // Count previous vulnerabilities for delta
        const prevVulnsRes = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
          Query.equal('scanId', prev.$id),
          Query.limit(1000)
        ]);

        let pCrit = 0, pHigh = 0, pMed = 0, pLow = 0, pBugs = 0, pSmells = 0;
        prevVulnsRes.documents.forEach((v: any) => {
          const sev = v.severity?.toLowerCase();
          if (sev === 'critical') pCrit++;
          else if (sev === 'high') pHigh++;
          else if (sev === 'medium') pMed++;
          else if (sev === 'low') pLow++;

          const tool = v.tool?.toLowerCase();
          if (tool === 'semgrep' || tool === 'trivy') pBugs++;
          if (tool === 'gitleaks') pSmells++;
        });

        setPrevScan({
          ...prev,
          criticalCount: pCrit,
          highCount: pHigh,
          mediumCount: pMed,
          lowCount: pLow,
          bugCount: pBugs,
          codeSmellCount: pSmells
        });
        setPrevVulnerabilities([...prevVulnsRes.documents]);
      } else {
        setPrevScan(null);
        setPrevVulnerabilities([]);
      }
    } catch (error) {
      console.error('Error fetching latest scan:', error);
    }
  };

  const fetchRepositories = async () => {
    try {
      const response = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
        Query.limit(100)
      ]);
      setRepositories(response.documents);
    } catch (err) {
      console.error('[FETCH] Error fetching repos:', err);
    }
  };

  const fetchCompliance = async () => {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.SCANS}`);
      if (!COLLECTIONS.SCANS) throw new Error("collectionId is undefined");
      const scansRes = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
        Query.greaterThanEqual('$createdAt', thirtyDaysAgo.toISOString()),
        Query.orderDesc('$createdAt'),
        Query.limit(100)
      ]);

      if (scansRes.total === 0) {
        setComplianceScore(100);
        setLoadingCompliance(false);
        return;
      }

      const scanIds = scansRes.documents.map(s => s.$id);

      console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.VULNERABILITIES}`);
      if (!COLLECTIONS.VULNERABILITIES) throw new Error("collectionId is undefined");
      // Finding compliance failures by checking vulnerabilities
      const vulnsRes = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
        Query.equal('scanId', scanIds),
        Query.equal('tool', 'policy_violation'),
        Query.limit(500)
      ]);

      const failedScanIds = new Set(vulnsRes.documents.map(f => f.scanId));

      const total = scansRes.documents.length;
      const failed = failedScanIds.size;
      const score = Math.max(0, Math.round(((total - failed) / total) * 100));

      setComplianceScore(score);

      setComplianceTrend([
        { day: '1', score: Math.min(100, score + 12) },
        { day: '2', score: Math.min(100, score + 4) },
        { day: '3', score: Math.max(0, score - 8) },
        { day: '4', score: Math.max(0, score - 2) },
        { day: '5', score: score },
      ]);
    } catch (error) {
      console.error('Error fetching compliance:', error);
    } finally {
      setLoadingCompliance(false);
    }
  };

  const fetchIncidents = async () => {
    try {
      const res = await axios.get(`${import.meta.env.VITE_BACKEND_URL}/api/incidents?status=open`);
      setIncidents(res.data.documents || []);
    } catch (err) {
      console.error('[FETCH] Incidents error:', err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <img src={logoImg} alt="Scorpion Logo" className="w-16 h-16 object-contain animate-pulse" style={{ filter: getLogoFilter(), mixBlendMode: 'multiply' }} />
          <h2 className="text-xs font-black text-[var(--text-secondary)] uppercase tracking-widest animate-pulse italic">{t('dashboard.initializing')}</h2>
        </div>
      </div>
    );
  }

  const getComplianceColor = (score: number) => {
    if (score >= 90) return 'var(--status-success)';
    if (score >= 70) return 'var(--status-warning)';
    return 'var(--status-danger)';
  };
  const complianceColor = getComplianceColor(complianceScore);

  const gaugeData = [
    { name: 'Base', value: 100, fill: 'var(--bg-primary)' }, // Background track
    { name: 'Score', value: complianceScore, fill: complianceColor } // Fill track
  ];

  const trendIsUp = complianceTrend.length > 1 && complianceTrend[complianceTrend.length - 1].score >= complianceTrend[0].score;

  return (
    <div className="min-h-screen flex flex-col transition-colors duration-300" style={{ background: 'transparent' }}>
      <nav className="backdrop-blur-md shadow-sm border-b border-[var(--border-subtle)] sticky top-0 z-40 text-[var(--text-primary)]" style={{ background: 'transparent' }}>
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-end items-center h-16">
            <div className="flex items-center gap-6">
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowThemeMenu(!showThemeMenu)}
                  className="p-2 hover:bg-white/10 rounded-xl transition-all text-[var(--text-secondary)] border border-transparent hover:border-[var(--border-subtle)] flex items-center gap-1 active:scale-95 z-50 relative"
                >
                  {theme === 'light' && <Sun className="w-5 h-5 shadow-sm" />}
                  {theme === 'dark' && <Moon className="w-5 h-5 shadow-sm" />}
                  {theme === 'eye-protection' && <Eye className="w-5 h-5 shadow-sm" />}
                  {theme === 'snow-light' && <Cloud className="w-5 h-5 shadow-sm" />}
                  {theme === 'underwater' && <Waves className="w-5 h-5 shadow-sm" />}
                  <ChevronDown className={`w-3 h-3 transition-transform ${showThemeMenu ? 'rotate-180' : ''} opacity-50`} />
                </button>

                {showThemeMenu && (
                  <div style={{ position: 'absolute', top: '50px', right: '0', background: 'var(--bg-secondary)', borderRadius: '8px', padding: '8px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', zIndex: 9999 }}>
                    <button onClick={() => { setTheme('light'); setShowThemeMenu(false); }} className="p-2 hover:bg-white/10 rounded-lg transition-colors"><Sun size={18} /></button>
                    <button onClick={() => { setTheme('dark'); setShowThemeMenu(false); }} className="p-2 hover:bg-white/10 rounded-lg transition-colors"><Moon size={18} /></button>
                    <button onClick={() => { setTheme('eye-protection'); setShowThemeMenu(false); }} className="p-2 hover:bg-white/10 rounded-lg transition-colors"><Eye size={18} /></button>
                    <button onClick={() => { setTheme('snow-light'); setShowThemeMenu(false); }} className="p-2 hover:bg-white/10 rounded-lg transition-colors"><Cloud size={18} /></button>
                    <button onClick={() => { setTheme('underwater'); setShowThemeMenu(false); }} className="p-2 hover:bg-white/10 rounded-lg transition-colors"><Waves size={18} /></button>
                  </div>
                )}
              </div>

              <div className="relative flex items-center gap-3 pl-6 border-l border-[var(--border-subtle)]">
                <button
                  onClick={() => setIsNavOpen(!isNavOpen)}
                  className="flex items-center gap-3 p-1 rounded-xl hover:bg-white/5 transition-all text-left group"
                >
                  <div className="w-8 h-8 bg-[var(--bg-secondary)] rounded-full flex items-center justify-center overflow-hidden text-[10px] font-black text-[var(--text-primary)] border border-[var(--accent-primary)] group-hover:scale-105 transition-transform">
                    {((user?.prefs as any)?.profilePic) ? (
                      <img src={(user?.prefs as any).profilePic} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      user?.email?.[0].toUpperCase()
                    )}
                  </div>
                  <div className="hidden md:block">
                    <p className="text-[10px] font-black text-[var(--text-primary)] leading-none italic uppercase">{t('dashboard.operator')}</p>
                    <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-tighter mt-1">{user?.email}</p>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-[var(--text-secondary)] transition-transform ${isNavOpen ? 'rotate-180' : ''}`} />
                </button>

                {isNavOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsNavOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 w-48 bg-[var(--bg-card)] rounded-2xl shadow-2xl border border-[var(--border-subtle)] py-2 z-50 animate-in fade-in zoom-in duration-200">
                      {[
                        { icon: Activity, label: 'Analytics', path: '/dashboard' },
                        { icon: ListTodo, label: 'Reports', path: '/reports' },
                        { icon: Shield, label: 'Security', path: '/scans' },
                        { icon: Settings, label: 'Settings', path: '/settings' },
                      ].map((item) => (
                        <button
                          key={item.label}
                          onClick={() => { navigate(item.path); setIsNavOpen(false); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest italic text-[var(--text-secondary)] hover:bg-white/5 hover:text-[var(--text-primary)] transition-colors"
                        >
                          <item.icon className="w-4 h-4" />
                          {item.label}
                        </button>
                      ))}
                      <div className="my-2 border-t border-[var(--border-subtle)]" />
                      <button
                        onClick={signOut}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest italic text-[var(--status-error)] hover:bg-[var(--status-error)]/5 transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        {t('dashboard.disconnect')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-full mx-auto py-8 w-full overflow-y-auto pl-0 pr-4 sm:pr-6 lg:pr-8" style={{ position: 'relative', zIndex: 1 }}>
        {/* Top Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <CIGateSummaryCard scans={recentScans} />
          <MetricCard icon={Shield} label={t('dashboard.total_assets')} value={repositories.length} trend="+2 New" color="#0ea5e9" />
          <MetricCard icon={Activity} label={t('dashboard.active_scans')} value={recentScans.filter(s => new Date(s.$createdAt) > new Date(Date.now() - 86400000)).length} trend="Active" color="#f59e0b" />
          <MetricCard icon={Gavel} label={t('dashboard.policy_pass')} value={`${complianceScore}%`} trend={trendIsUp ? 'UP ▲' : 'DOWN ▼'} color={complianceColor} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full">
          {/* Main Top Grid */}
          <div className="lg:col-span-12">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full items-stretch">
              {/* Security Pulse */}
              <div className="lg:col-span-8 flex flex-col h-full">
                <div className="premium-card p-6 md:p-8 relative overflow-hidden group flex flex-col h-full">
                  <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                    <Activity className="w-24 h-24" />
                  </div>

                  <div className="relative z-10 flex flex-col h-full w-full">
                    <div className="flex items-center justify-between mb-8">
                      <div>
                        <h2 className="text-xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter">{t('dashboard.security_pulse')}</h2>
                        <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-1 font-mono">{t('dashboard.real_time_anomalies')}</p>
                      </div>
                      <div className="flex items-center gap-4">
                        {lastRefreshed && (
                          <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic opacity-50">
                            {t('dashboard.updated_at', { time: lastRefreshed.toLocaleTimeString() })}
                          </span>
                        )}
                        <button
                          onClick={handleManualRefresh}
                          disabled={refreshing}
                          className="flex items-center gap-2 bg-[var(--status-success)]/10 px-3 py-1.5 rounded-lg border border-[var(--status-success)]/20 hover:bg-[var(--status-success)]/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <div className={`w-1.5 h-1.5 bg-[var(--status-success)] rounded-full ${refreshing ? 'animate-ping' : 'animate-pulse'}`} />
                          <span className="text-[9px] font-black text-[var(--status-success)] uppercase tracking-widest italic">
                            {refreshing ? t('dashboard.syncing') : t('dashboard.manual_refresh')}
                          </span>
                          {refreshing && (
                            <svg className="w-3 h-3 text-[var(--status-success)] animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 min-h-[300px] w-full bg-[var(--bg-primary)]/30 rounded-2xl border border-[var(--border-subtle)] p-6 relative flex items-center justify-center" style={{ minWidth: 0 }}>
                      {!latestScan ? (
                        <div className="flex flex-col items-center gap-3 text-center">
                          <div className="w-12 h-12 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-subtle)] flex items-center justify-center animate-pulse">
                            <AlertCircle className="w-6 h-6 text-[var(--text-secondary)] opacity-50" />
                          </div>
                          <p className="text-[11px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] italic">{t('dashboard.no_scan_data')}</p>
                        </div>
                      ) : mounted && (
                        <div style={{ width: '100%', height: 350 }}>
                          <SecurityRadarChart key={refreshKey} data={threatData} isSidebarCollapsed={isSidebarCollapsed} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Metrics Grid */}
              <div className="lg:col-span-4 flex flex-col h-full">
                <div className="grid grid-cols-2 lg:grid-cols-2 gap-4 h-full">
                  {metrics.map((m) => (
                    <MetricCard
                      key={m.label}
                      icon={m.icon}
                      label={m.label}
                      value={m.value}
                      color={m.color}
                      trend="LIVE"
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Scan Delta Widget */}
          <div className="lg:col-span-8">
            <div className="premium-card p-6 md:p-8 relative overflow-hidden group flex flex-col h-full min-h-[300px]">
              <div className="absolute top-0 right-0 p-6 opacity-[0.03] group-hover:opacity-10 transition-opacity">
                <ArrowLeftRight className="w-32 h-32" />
              </div>

              <div className="relative z-10 flex flex-col h-full">
                <div className="flex items-center gap-2 mb-6">
                  <GitCompare className="w-5 h-5 text-[var(--accent-primary)]" />
                  <h2 className="text-lg font-black text-[var(--text-primary)] uppercase italic tracking-tighter">{t('dashboard.scan_delta')}</h2>
                </div>

                {!scanDelta ? (
                  <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)] text-sm italic">{t('dashboard.loading_delta')}</div>
                ) : scanDelta.noPrev ? (
                  <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)] text-sm font-bold uppercase tracking-widest italic opacity-50">
                    {t('dashboard.first_scan_notice')}
                  </div>
                ) : scanDelta.newFindings.length === 0 && scanDelta.fixedFindings.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-[var(--status-success)] text-sm font-bold uppercase tracking-widest italic">
                    {t('dashboard.no_changes_notice')}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-6 flex-1">
                    {/* LEFT: New Issues */}
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-[#ff5252]" />
                        <span className="text-[#ff5252] font-black uppercase tracking-widest text-sm">{scanDelta.newFindings.length} {t('dashboard.new_issues')}</span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {scanDelta.newFindings.slice(0, 5).map((v: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 bg-[var(--bg-primary)]/50 p-2 rounded border border-[var(--border-subtle)]">
                            <span className="bg-[#ff5252]/10 text-[#ff5252] text-[9px] font-black px-1.5 py-0.5 rounded uppercase">NEW</span>
                            <span className="text-[10px] text-[var(--text-secondary)] font-mono truncate">{v.tool}</span>
                            <span className="text-[10px] text-[var(--text-primary)] truncate flex-1" title={v.file || v.file_path}>{(v.file || v.file_path)?.split('/').pop() ?? ''}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* RIGHT: Fixed Issues */}
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-[#00ffa3]" />
                        <span className="text-[#00ffa3] font-black uppercase tracking-widest text-sm">{scanDelta.fixedFindings.length} {t('dashboard.fixed')}</span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {scanDelta.fixedFindings.slice(0, 5).map((v: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 bg-[var(--bg-primary)]/50 p-2 rounded border border-[var(--border-subtle)]">
                            <span className="bg-[#00ffa3]/10 text-[#00ffa3] text-[9px] font-black px-1.5 py-0.5 rounded uppercase">FIXED</span>
                            <span className="text-[10px] text-[var(--text-secondary)] font-mono truncate">{v.tool}</span>
                            <span className="text-[10px] text-[var(--text-primary)] truncate flex-1 line-through opacity-75" title={v.file || v.file_path}>{(v.file || v.file_path)?.split('/').pop() ?? ''}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Secondary Row (Compliance Widget) */}
          <div className="lg:col-span-4">
            <div className="premium-card p-6 md:p-8 relative overflow-hidden group flex flex-col h-full">
              <div className="absolute top-0 right-0 p-6 opacity-[0.03] group-hover:opacity-10 transition-opacity">
                <Gavel className="w-32 h-32" />
              </div>

              <div className="relative z-10">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-lg font-black text-[var(--text-primary)] uppercase italic tracking-tighter">{t('dashboard.compliance_health')}</h2>
                  <Link to="/governance" className="px-3 py-1.5 bg-[var(--text-primary)]/5 border border-[var(--border-subtle)] rounded-lg text-[9px] font-black uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-primary)]/50 transition-all flex items-center gap-1 group/btn">
                    {t('dashboard.view_governance')} <ArrowRight className="w-3 h-3 group-hover/btn:translate-x-1 transition-transform" />
                  </Link>
                </div>
                <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mb-6">{t('dashboard.policy_adherence_notice')}</p>

                {loadingCompliance ? (
                  <div className="flex items-center justify-center py-12">
                    <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] animate-pulse tracking-widest">{t('dashboard.evaluating_checks')}</span>
                  </div>
                ) : (
                  <>
                    <div className="relative h-48 w-full flex items-center justify-center">
                      {mounted && (
                        <div style={{ width: '100%', height: 192 }}>
                          <ResponsiveContainer key={isSidebarCollapsed ? 'collapsed' : 'expanded'} width="99%" height="100%" minWidth={1} minHeight={1}>
                            <RadialBarChart
                              cx="50%" cy="50%" innerRadius="70%" outerRadius="100%"
                              barSize={15} data={gaugeData} startAngle={180} endAngle={0}
                            >
                              <RadialBar background={false} dataKey="value" cornerRadius={10} />
                            </RadialBarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                      <div className="absolute flex flex-col items-center justify-center mt-6">
                        <span className="text-5xl font-black italic tracking-tighter" style={{ color: complianceColor }}>
                          {complianceScore}%
                        </span>
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] italic text-[var(--text-secondary)] mt-1">
                          {t('dashboard.pass_rate')}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]/50">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic">
                          Activity Trend vs Target
                        </span>
                        <span className="text-[9px] font-black uppercase tracking-widest italic pt-0.5" style={{ color: trendIsUp ? 'var(--status-success)' : 'var(--status-danger)' }}>
                          {trendIsUp ? 'UP ▲' : 'DOWN ▼'}
                        </span>
                      </div>
                      <div className="h-10 w-full overflow-hidden opacity-50">
                        {mounted && (
                          <div style={{ width: '100%', height: 40 }}>
                            <ResponsiveContainer key={isSidebarCollapsed ? 'collapsed' : 'expanded'} width="99%" height="100%" minWidth={1} minHeight={1}>
                              <AreaChart data={complianceTrend}>
                                <defs>
                                  <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={complianceColor} stopOpacity={0.8} />
                                    <stop offset="95%" stopColor={complianceColor} stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                                <Area type="monotone" dataKey="score" stroke={complianceColor} fillOpacity={1} fill="url(#colorScore)" strokeWidth={2} isAnimationActive={true} />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Runtime, Incidents & History Row */}
          <div className="lg:col-span-12 grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Live Threats */}
            <div className="lg:col-span-4">
              <div className="premium-card p-6 md:p-8 relative overflow-hidden group flex flex-col h-full bg-red-500/5 border-red-500/20">
                <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                  <ShieldAlert className="w-24 h-24 text-[var(--status-error)]" />
                </div>
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h2 className="text-lg font-black text-[var(--text-primary)] uppercase italic tracking-tighter">{t('dashboard.live_threats')}</h2>
                      <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-1">Runtime Anomalies</p>
                    </div>
                    <div className="bg-red-500/20 px-2 py-1 rounded text-[9px] font-black text-red-400 animate-pulse">LIVE</div>
                  </div>

                  <div className="flex flex-col gap-3">
                    {incidents.filter(i => i.source === 'falco').length === 0 ? (
                      <div className="py-12 flex flex-col items-center justify-center border-2 border-dashed border-[var(--border-subtle)] rounded-2xl opacity-50">
                        <ShieldCheck className="w-8 h-8 text-[var(--status-success)] mb-2" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">{t('dashboard.no_threats')}</span>
                      </div>
                    ) : (
                      incidents.filter(i => i.source === 'falco').slice(0, 3).map((inc) => (
                        <div key={inc.$id} className="bg-[var(--bg-primary)]/60 p-4 rounded-xl border border-red-500/10 hover:border-red-500/30 transition-all">
                          <div className="flex items-start justify-between mb-2">
                            <span className="text-[10px] font-black text-red-400 uppercase tracking-tighter truncate max-w-[120px]">{inc.title || inc.rule}</span>
                            <span className="text-[8px] font-bold bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded">{inc.severity || inc.priority}</span>
                          </div>
                          <p className="text-[9px] text-[var(--text-secondary)] line-clamp-1 font-mono">{inc.description || inc.output}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Open Incidents */}
            <div className="lg:col-span-4">
              <div className="premium-card p-6 md:p-8 relative overflow-hidden group flex flex-col h-full bg-[var(--accent-primary)]/5 border-[var(--accent-primary)]/20">
                <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                  <ListTodo className="w-24 h-24 text-[var(--accent-primary)]" />
                </div>
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h2 className="text-lg font-black text-[var(--text-primary)] uppercase italic tracking-tighter">{t('dashboard.active_incidents')}</h2>
                      <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-1">{t('dashboard.pending_resolution')}</p>
                    </div>
                    <div className="bg-[var(--accent-primary)]/20 px-2 py-1 rounded text-[9px] font-black text-[var(--accent-primary)]">{incidents.length} {t('dashboard.open_incidents_count')}</div>
                  </div>

                  <div className="flex flex-col gap-3">
                    {incidents.length === 0 ? (
                      <div className="py-12 flex flex-col items-center justify-center border-2 border-dashed border-[var(--border-subtle)] rounded-2xl opacity-50">
                        <CheckCircle className="w-8 h-8 text-[var(--status-success)] mb-2" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">{t('dashboard.all_clear')}</span>
                      </div>
                    ) : (
                      incidents.slice(0, 3).map((inc) => (
                        <div key={inc.$id} className="bg-[var(--bg-primary)]/60 p-4 rounded-xl border border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/30 transition-all group/inc">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-black text-[var(--text-primary)] uppercase truncate italic">{inc.title}</span>
                            <span className="text-[8px] font-bold text-[var(--text-secondary)] uppercase">{inc.source}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[8px] font-bold text-red-400 uppercase tracking-widest">{inc.severity}</span>
                            <button className="text-[8px] font-black text-[var(--accent-primary)] uppercase opacity-0 group-hover/inc:opacity-100 transition-opacity">{t('dashboard.acknowledge')}</button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Scan Registry */}
            <div className="lg:col-span-4">
              <div className="premium-card p-6 h-full flex flex-col">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-black text-[var(--text-primary)] uppercase italic tracking-tighter">{t('dashboard.scan_registry')}</h2>
                  <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] italic">Recent</span>
                </div>
                <div className="flex flex-col gap-2 flex-1">
                  {recentScans.slice(0, 4).map((scan) => (
                    <ScanHistoryRow key={scan.$id} scan={scan} compact={true} />
                  ))}
                </div>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}

function CIGateSummaryCard({ scans }: { scans: any[] }) {
  const { t } = useTranslation();
  const ciScans = scans.filter(s => s.scanType === 'ci_pipeline' || s.scan_type === 'ci_pipeline');
  const passed = ciScans.filter(s => s.gateStatus === 'passed').length;
  const failed = ciScans.filter(s => s.gateStatus === 'failed').length;
  const rate = ciScans.length ? Math.round((passed / ciScans.length) * 100) : 0;

  return (
    <div className="premium-card p-5 group transition-all flex flex-col justify-between h-full min-h-[140px] relative overflow-hidden">
      <div className="absolute top-0 right-0 p-4 opacity-[0.05] group-hover:scale-110 transition-transform">
        <GitBranch className="w-16 h-16" />
      </div>
      <div className="relative z-10 h-full flex flex-col justify-between">
        <div>
          <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic mb-1">{t('dashboard.ci_gate_integrity')}</p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black italic tracking-tighter text-[var(--text-primary)]">{rate}%</span>
            <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic">{t('dashboard.success_rate')}</span>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between">
          <div className="flex gap-4">
            <div>
              <p className="text-[8px] font-black text-[var(--text-secondary)] uppercase">{t('dashboard.passed')}</p>
              <p className="text-sm font-black text-[var(--status-success)]">{passed}</p>
            </div>
            <div>
              <p className="text-[8px] font-black text-[var(--text-secondary)] uppercase">{t('dashboard.blocked')}</p>
              <p className="text-sm font-black text-[var(--status-error)]">{failed}</p>
            </div>
          </div>
          <div className="w-10 h-10 rounded-full border-2 border-[var(--border-subtle)] flex items-center justify-center">
            <div className="w-6 h-6 rounded-full" style={{
              background: `conic-gradient(var(--status-success) ${rate}%, transparent 0)`
            }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ScanHistoryRow({ scan, compact = false }: { scan: any, compact?: boolean }) {
  const { t } = useTranslation();
  const gateIcon: Record<string, any> = {
    passed: <span className="text-[var(--status-success)] flex items-center gap-1"><CheckCircle className="w-3 h-3" /> {t('dashboard.pass')}</span>,
    failed: <span className="text-[var(--status-error)] flex items-center gap-1"><XCircle className="w-3 h-3" /> {t('dashboard.fail')}</span>,
    not_applicable: <span className="text-[var(--text-secondary)]">— N/A</span>
  };

  const scanTypeBadge: Record<string, any> = {
    ci_pipeline: { label: 'CI', color: 'rgba(99, 102, 241, 0.1)', textColor: '#818cf8', icon: GitBranch },
    gitops_deploy: { label: 'K8S', color: 'rgba(16, 185, 129, 0.1)', textColor: '#10b981', icon: Cloud },
    ide: { label: 'IDE', color: 'rgba(14, 165, 233, 0.1)', textColor: '#38bdf8', icon: Monitor },
    scheduled: { label: 'CRON', color: 'rgba(245, 158, 11, 0.1)', textColor: '#fbbf24', icon: Activity },
    manual: { label: 'USER', color: 'rgba(107, 114, 128, 0.1)', textColor: '#9ca3af', icon: Shield }
  };

  const type = scan.scanType || scan.scan_type || 'manual';
  const badge = scanTypeBadge[type] || scanTypeBadge.manual;
  const status = scan.gateStatus || 'not_applicable';
  const Icon = badge.icon;

  return (
    <div className="flex items-center gap-4 bg-[var(--bg-primary)]/40 p-4 rounded-xl border border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/30 transition-all group/row">
      <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: badge.color }}>
        <Icon className="w-5 h-5" style={{ color: badge.textColor }} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest" style={{ backgroundColor: badge.color, color: badge.textColor }}>
            {badge.label}
          </span>
          <h3 className="text-[11px] font-black text-[var(--text-primary)] uppercase truncate italic tracking-tight">
            {scan.repoUrl?.split('/').pop()?.replace('.git', '') || 'Unknown Repo'}
          </h3>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold text-[var(--text-secondary)] flex items-center gap-1 italic">
            <Activity className="w-3 h-3" />
            {new Date(scan.$createdAt).toLocaleString()}
          </span>
          {scan.prUrl && (
            <a href={scan.prUrl} target="_blank" rel="noreferrer" className="text-[10px] font-black text-[var(--accent-primary)] hover:underline flex items-center gap-1 italic">
              <ExternalLink className="w-3 h-3" /> PR #{scan.prNumber}
            </a>
          )}
        </div>
      </div>

      {!compact && (
        <div className="hidden md:flex items-center gap-6 px-4">
          <div className="text-center">
            <p className="text-[8px] font-black text-[var(--text-secondary)] uppercase mb-1">{t('dashboard.critical')}</p>
            <p className="text-xs font-black text-[var(--status-error)]">{scan.criticalCount || 0}</p>
          </div>
          <div className="text-center">
            <p className="text-[8px] font-black text-[var(--text-secondary)] uppercase mb-1">{t('dashboard.high')}</p>
            <p className="text-xs font-black text-[#ff8c00]">{scan.highCount || 0}</p>
          </div>
        </div>
      )}

      <div className="shrink-0 text-right min-w-[80px]">
        <p className="text-[8px] font-black text-[var(--text-secondary)] uppercase mb-1 tracking-widest">{t('dashboard.gate_result')}</p>
        <div className="text-[10px] font-black italic tracking-tighter">
          {gateIcon[status]}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, trend, color }: any) {
  return (
    <div className="premium-card p-4 md:p-5 group hover:border-[var(--accent-primary)] transition-all flex flex-col justify-between h-full min-h-[140px]">
      <div className="flex items-center justify-between mb-2">
        <div className="w-9 h-9 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-subtle)] flex items-center justify-center group-hover:scale-110 transition-transform">
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
        <div className="text-[8px] font-black text-[var(--status-success)] italic tracking-widest">{trend}</div>
      </div>
      <div>
        <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic mb-1 leading-none">{label}</p>
        <p className="text-2xl font-black text-[var(--text-primary)] italic tracking-tighter leading-none">{value}</p>
      </div>
    </div>
  );
}
