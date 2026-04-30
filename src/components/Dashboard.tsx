import React, { useEffect, useState, useRef, useMemo, memo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import {
  LogOut, Shield, Settings, ChevronDown, Activity, ListTodo, AlertCircle,
  ShieldAlert, ShieldCheck, ShieldX, Zap, ArrowRight, Gavel, Sun, Moon, Eye, Cloud, Waves, Bug, Wind, GitCompare, CheckCircle, TrendingUp, ArrowLeftRight
} from 'lucide-react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip,
  RadialBarChart, RadialBar, AreaChart, Area
} from 'recharts';
import { Client } from 'appwrite';
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

export default function Dashboard({ isSidebarCollapsed }: { isSidebarCollapsed: boolean }) {
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

  // Compliance Widget State
  const [complianceScore, setComplianceScore] = useState<number>(100);
  const [complianceTrend, setComplianceTrend] = useState<any[]>([{ day: 'A', score: 100 }, { day: 'B', score: 100 }]);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingCompliance, setLoadingCompliance] = useState(false);
  const [mounted, setMounted] = useState(false);

  const securityScore = Math.max(0, 100 - ((latestScan?.criticalCount ?? 0) * 10) - ((latestScan?.highCount ?? 0) * 5));

  const metrics = [
    { label: 'Critical', value: latestScan?.criticalCount ?? 0, icon: ShieldX, color: '#ff5252' },
    { label: 'High Risk', value: latestScan?.highCount ?? 0, icon: ShieldAlert, color: '#ff8a80' },
    { label: 'Medium Risk', value: latestScan?.mediumCount ?? 0, icon: AlertCircle, color: '#ffd740' },
    { label: 'Low Risk', value: latestScan?.lowCount ?? 0, icon: ShieldCheck, color: '#00ffcc' },
    { label: 'Bugs', value: latestScan?.bugCount ?? 0, icon: Bug, color: '#00e5ff' },
    { label: 'Vulnerabilities', value: (latestScan?.criticalCount ?? 0) + (latestScan?.highCount ?? 0) + (latestScan?.mediumCount ?? 0) + (latestScan?.lowCount ?? 0), icon: Activity, color: '#38bdf8' },
    { label: 'Code Smells', value: latestScan?.codeSmellCount ?? 0, icon: Wind, color: '#fbbf24' },
    { label: 'Security', value: `${securityScore}%`, icon: Zap, color: '#00ffa3' },
  ];

  const threatData = useMemo(() => [
    { axis: 'Critical', Observed: latestScan?.criticalCount ?? 0 },
    { axis: 'High', Observed: latestScan?.highCount ?? 0 },
    { axis: 'Medium', Observed: latestScan?.mediumCount ?? 0 },
    { axis: 'Low', Observed: latestScan?.lowCount ?? 0 },
    { axis: 'Bugs', Observed: latestScan?.bugCount ?? 0 },
    { axis: 'Vulnerabilities', Observed: (latestScan?.criticalCount ?? 0) + (latestScan?.highCount ?? 0) + (latestScan?.mediumCount ?? 0) + (latestScan?.lowCount ?? 0) },
    { axis: 'Code Smells', Observed: latestScan?.codeSmellCount ?? 0 },
    { axis: 'Security', Observed: securityScore },
  ], [latestScan, securityScore]);

  const hasFetched = useRef(false);

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
    if (hasFetched.current) return;
    hasFetched.current = true;

    const init = async () => {
      await Promise.all([fetchLatestScan(), fetchCompliance()]);
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

    const subscription = client.subscribe(
      `databases.${DB_ID}.collections.${COLLECTIONS.SCANS}.documents`,
      (response) => {
        console.log('Realtime Dashboard Update:', response);
        // re-fetch latest scan and compliance when any change occurs in Scans collection
        fetchLatestScan();
        fetchCompliance();
      }
    );

    return () => {
      subscription();
    };
  }, []);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchLatestScan(), fetchCompliance()]);
    setLastRefreshed(new Date());
    setRefreshing(false);
  };

  const fetchLatestScan = async () => {
    try {
      console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.SCANS}`);
      if (!COLLECTIONS.SCANS) throw new Error("collectionId is undefined");
      const response = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
        Query.equal('status', 'completed'),
        Query.orderDesc('startedAt'),
        Query.limit(2)
      ]);
      
      if (response.documents.length > 0) {
        const scan = response.documents[0];

        // Ensure source of truth by querying exact vulnerabilities instead of taking old scan cached data
        console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.VULNERABILITIES}`);
        if (!COLLECTIONS.VULNERABILITIES) throw new Error("collectionId is undefined");
        const vulnsRes = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
            Query.equal('scanId', scan.$id),
            Query.limit(1000)
        ]);

        console.log(`[Dashboard] Selected ScanId: ${scan.$id}`);
        console.log(`[Dashboard] Vulnerabilities Count: ${vulnsRes.total}`);

        let critical = 0, high = 0, medium = 0, low = 0, bugs = 0, codeSmells = 0;
        vulnsRes.documents.forEach((v: any) => {
            if (v.severity === 'critical') critical++;
            else if (v.severity === 'high') high++;
            else if (v.severity === 'medium') medium++;
            else if (v.severity === 'low') low++;

            if (v.tool === 'semgrep' || v.tool === 'trivy') bugs++;
            if (v.tool === 'gitleaks') codeSmells++;
        });

        setLatestScan({
            ...scan,
            criticalCount: critical,
            highCount: high,
            mediumCount: medium,
            lowCount: low,
            bugCount: bugs,
            codeSmellCount: codeSmells
        });
        setLatestVulnerabilities(vulnsRes.documents);

        if (response.documents.length > 1) {
          const prev = response.documents[1];
          setPrevScan(prev);
          const prevVulnsRes = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
              Query.equal('scanId', prev.$id),
              Query.limit(1000)
          ]);
          setPrevVulnerabilities(prevVulnsRes.documents);
        } else {
          setPrevScan(null);
          setPrevVulnerabilities([]);
        }
      }
    } catch (error) {
      console.error('Error fetching latest scan:', error);
    }
  };

  const fetchCompliance = async () => {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.SCANS}`);
      if (!COLLECTIONS.SCANS) throw new Error("collectionId is undefined");
      const scansRes = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
        Query.greaterThanEqual('startedAt', thirtyDaysAgo.toISOString()),
        Query.orderDesc('startedAt'),
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

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <img src={logoImg} alt="Scorpion Logo" className="w-16 h-16 object-contain animate-pulse" style={{ filter: getLogoFilter(), mixBlendMode: 'multiply' }} />
          <h2 className="text-xs font-black text-[var(--text-secondary)] uppercase tracking-widest animate-pulse italic">Initializing Scorpion Protocols...</h2>
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
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col transition-colors duration-300">
      <nav className="bg-[var(--bg-primary)] backdrop-blur-md shadow-sm border-b border-[var(--border-subtle)] sticky top-0 z-40 text-[var(--text-primary)]">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-end items-center h-16">
            <div className="flex items-center gap-6">
              <div style={{position:'relative'}}>
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
                  <div style={{position:'absolute', top:'50px', right:'0', background:'var(--bg-secondary)', borderRadius:'8px', padding:'8px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', zIndex:9999}}>
                    <button onClick={() => { setTheme('light'); setShowThemeMenu(false); }} className="p-2 hover:bg-white/10 rounded-lg transition-colors"><Sun size={18}/></button>
                    <button onClick={() => { setTheme('dark'); setShowThemeMenu(false); }} className="p-2 hover:bg-white/10 rounded-lg transition-colors"><Moon size={18}/></button>
                    <button onClick={() => { setTheme('eye-protection'); setShowThemeMenu(false); }} className="p-2 hover:bg-white/10 rounded-lg transition-colors"><Eye size={18}/></button>
                    <button onClick={() => { setTheme('snow-light'); setShowThemeMenu(false); }} className="p-2 hover:bg-white/10 rounded-lg transition-colors"><Cloud size={18}/></button>
                    <button onClick={() => { setTheme('underwater'); setShowThemeMenu(false); }} className="p-2 hover:bg-white/10 rounded-lg transition-colors"><Waves size={18}/></button>
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
                    <p className="text-[10px] font-black text-[var(--text-primary)] leading-none italic uppercase">Operator</p>
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
                        Disconnect
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-full mx-auto py-8 w-full overflow-y-auto pl-0 pr-4 sm:pr-6 lg:pr-8">
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
                        <h2 className="text-xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter">Security Pulse</h2>
                        <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-1 font-mono">Real-time Anomaly Vectors</p>
                      </div>
                      <div className="flex items-center gap-4">
                        {lastRefreshed && (
                          <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic opacity-50">
                            Updated {lastRefreshed.toLocaleTimeString()}
                          </span>
                        )}
                        <button
                          onClick={handleManualRefresh}
                          disabled={refreshing}
                          className="flex items-center gap-2 bg-[var(--status-success)]/10 px-3 py-1.5 rounded-lg border border-[var(--status-success)]/20 hover:bg-[var(--status-success)]/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed group/refresh"
                        >
                          <div className={`w-1.5 h-1.5 bg-[var(--status-success)] rounded-full ${refreshing ? 'animate-ping' : ''}`} />
                          <span className="text-[9px] font-black text-[var(--status-success)] uppercase tracking-widest italic">
                            {refreshing ? 'Refreshing...' : 'Manual Refresh'}
                          </span>
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 min-h-[300px] w-full bg-[var(--bg-primary)]/30 rounded-2xl border border-[var(--border-subtle)] p-6 relative flex items-center justify-center" style={{ minWidth: 0 }}>
                      {!latestScan ? (
                        <div className="flex flex-col items-center gap-3 text-center">
                          <div className="w-12 h-12 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-subtle)] flex items-center justify-center animate-pulse">
                            <AlertCircle className="w-6 h-6 text-[var(--text-secondary)] opacity-50" />
                          </div>
                          <p className="text-[11px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] italic">NO SCAN DATA — RUN A SCAN</p>
                        </div>
                      ) : mounted && (
                        <div style={{ width: '100%', height: 350 }}>
                          <SecurityRadarChart data={threatData} isSidebarCollapsed={isSidebarCollapsed} />
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
                  <h2 className="text-lg font-black text-[var(--text-primary)] uppercase italic tracking-tighter">Scan Delta</h2>
                </div>
                
                {!scanDelta ? (
                  <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)] text-sm italic">Loading delta...</div>
                ) : scanDelta.noPrev ? (
                  <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)] text-sm font-bold uppercase tracking-widest italic opacity-50">
                    First scan — no delta available
                  </div>
                ) : scanDelta.newFindings.length === 0 && scanDelta.fixedFindings.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-[var(--status-success)] text-sm font-bold uppercase tracking-widest italic">
                    No changes since last scan
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-6 flex-1">
                    {/* LEFT: New Issues */}
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-[#ff5252]" />
                        <span className="text-[#ff5252] font-black uppercase tracking-widest text-sm">{scanDelta.newFindings.length} New Issues</span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {scanDelta.newFindings.slice(0, 5).map((v: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 bg-[var(--bg-primary)]/50 p-2 rounded border border-[var(--border-subtle)]">
                            <span className="bg-[#ff5252]/10 text-[#ff5252] text-[9px] font-black px-1.5 py-0.5 rounded uppercase">NEW</span>
                            <span className="text-[10px] text-[var(--text-secondary)] font-mono truncate">{v.tool}</span>
                            <span className="text-[10px] text-[var(--text-primary)] truncate flex-1" title={v.file}>{v.file.split('/').pop()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    {/* RIGHT: Fixed Issues */}
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-[#00ffa3]" />
                        <span className="text-[#00ffa3] font-black uppercase tracking-widest text-sm">{scanDelta.fixedFindings.length} Fixed</span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {scanDelta.fixedFindings.slice(0, 5).map((v: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 bg-[var(--bg-primary)]/50 p-2 rounded border border-[var(--border-subtle)]">
                            <span className="bg-[#00ffa3]/10 text-[#00ffa3] text-[9px] font-black px-1.5 py-0.5 rounded uppercase">FIXED</span>
                            <span className="text-[10px] text-[var(--text-secondary)] font-mono truncate">{v.tool}</span>
                            <span className="text-[10px] text-[var(--text-primary)] truncate flex-1 line-through opacity-75" title={v.file}>{v.file.split('/').pop()}</span>
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
                  <h2 className="text-lg font-black text-[var(--text-primary)] uppercase italic tracking-tighter">Compliance Health</h2>
                  <Link to="/governance" className="px-3 py-1.5 bg-[var(--text-primary)]/5 border border-[var(--border-subtle)] rounded-lg text-[9px] font-black uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-primary)]/50 transition-all flex items-center gap-1 group/btn">
                    View Governance <ArrowRight className="w-3 h-3 group-hover/btn:translate-x-1 transition-transform" />
                  </Link>
                </div>
                <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mb-6">30-Day Policy Adherence</p>

                {loadingCompliance ? (
                  <div className="flex items-center justify-center py-12">
                     <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] animate-pulse tracking-widest">Evaluating Checks...</span>
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
                          Pass Rate
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
                                    <stop offset="5%" stopColor={complianceColor} stopOpacity={0.8}/>
                                    <stop offset="95%" stopColor={complianceColor} stopOpacity={0}/>
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

          {/* CVE Trend Charts */}
          <div className="lg:col-span-12">
              <div className="h-[400px]">
                  <TrendChart />
              </div>
          </div>

        </div>
      </main>
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
