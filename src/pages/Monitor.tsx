import React, { useEffect, useState } from 'react';
import { 
  Activity, Shield, AlertTriangle, CheckCircle, 
  Clock, RefreshCw, BarChart3, List, ChevronRight 
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer 
} from 'recharts';
import { monitorService } from '../services/monitorService';
import { client, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';

export default function Monitor() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [trends, setTrends] = useState<any[]>([]);
  const [health, setHealth] = useState<any[]>([]);
  const [findings, setFindings] = useState<any[]>([]);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const fetchData = async () => {
    try {
      const [trendData, healthData, findingsData] = await Promise.all([
        monitorService.getVulnerabilityTrends(7),
        monitorService.getRepoHealth(),
        monitorService.getLatestFindings()
      ]);
      setTrends(trendData);
      setHealth(healthData);
      setFindings(findingsData);
      setLastUpdated(new Date());
    } catch (err) {
      console.error(err);
      toast.error(t('monitor.fetch_error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    
    // Subscribe to new findings
    const unsubscribeFindings = client.subscribe(
      `databases.${DB_ID}.collections.${COLLECTIONS.VULNERABILITIES}.documents`,
      (response: any) => {
        if (response.events.includes('databases.*.collections.*.documents.*.create')) {
          setFindings(prev => [response.payload, ...prev].slice(0, 10));
          toast.success(t('monitor.new_finding_detected'), { icon: '🔍' });
        }
      }
    );

    // Subscribe to scan status changes
    const unsubscribeScans = client.subscribe(
      `databases.${DB_ID}.collections.${COLLECTIONS.SCANS}.documents`,
      (response: any) => {
        if (response.events.includes('databases.*.collections.*.documents.*.update')) {
          fetchData(); // Refresh health scorecards when a scan completes
        }
      }
    );

    const interval = setInterval(fetchData, 300000); // Reduce polling to every 5 mins as backup
    
    return () => {
      unsubscribeFindings();
      unsubscribeScans();
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <RefreshCw className="w-8 h-8 animate-spin text-[var(--accent-primary)]" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[var(--accent-primary)]/10 rounded-xl flex items-center justify-center border border-[var(--accent-primary)]/20 shadow-[0_0_15px_rgba(var(--accent-primary-rgb),0.1)]">
            <Activity className="text-[var(--accent-primary)] w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-[var(--text-primary)] uppercase tracking-tighter italic">
              {t('monitor.title')}
            </h1>
            <p className="text-[var(--text-secondary)] text-xs font-bold uppercase tracking-widest flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              {t('monitor.live_status')} • {t('dashboard.updated_at', { time: lastUpdated.toLocaleTimeString() })}
            </p>
          </div>
        </div>
        <button onClick={fetchData} className="btn-premium flex items-center gap-2 px-4 py-2 text-xs">
          <RefreshCw size={14} /> {t('dashboard.manual_refresh')}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Trend Graph */}
        <div className="lg:col-span-2 premium-card p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-widest italic flex items-center gap-2">
              <BarChart3 size={18} className="text-[var(--accent-primary)]" />
              {t('monitor.threat_trend')}
            </h2>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trends}>
                <defs>
                  <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent-primary)" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                <XAxis 
                  dataKey="date" 
                  stroke="var(--text-secondary)" 
                  fontSize={10} 
                  tickFormatter={(val) => new Date(val).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                />
                <YAxis stroke="var(--text-secondary)" fontSize={10} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-subtle)', borderRadius: '12px' }}
                  itemStyle={{ color: 'var(--accent-primary)', fontSize: '12px', fontWeight: 'bold' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="count" 
                  stroke="var(--accent-primary)" 
                  fillOpacity={1} 
                  fill="url(#colorCount)" 
                  strokeWidth={3}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Live Findings Feed */}
        <div className="premium-card p-6 flex flex-col">
          <h2 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-widest italic flex items-center gap-2 mb-6">
            <List size={18} className="text-[var(--accent-primary)]" />
            {t('monitor.live_feed')}
          </h2>
          <div className="space-y-4 flex-1 overflow-y-auto max-h-[300px] pr-2 custom-scrollbar">
            {findings.length === 0 ? (
              <p className="text-[var(--text-secondary)] text-[10px] text-center mt-10 uppercase font-bold italic tracking-widest">
                {t('monitor.no_findings')}
              </p>
            ) : (
              findings.map((finding) => (
                <div key={finding.$id} className="p-3 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-subtle)] group hover:border-[var(--accent-primary)]/50 transition-all">
                  <div className="flex justify-between items-start mb-1">
                    <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest italic ${
                      finding.severity === 'critical' ? 'bg-red-500/20 text-red-500' :
                      finding.severity === 'high' ? 'bg-orange-500/20 text-orange-500' :
                      'bg-blue-500/20 text-blue-500'
                    }`}>
                      {finding.severity}
                    </span>
                    <span className="text-[8px] text-[var(--text-secondary)] font-mono">
                      {new Date(finding.$createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-[10px] text-[var(--text-primary)] font-bold truncate">{finding.title}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Repo Health Grid */}
      <div className="space-y-6">
        <h2 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-widest italic flex items-center gap-2">
          <Shield size={18} className="text-[var(--accent-primary)]" />
          {t('monitor.fleet_health')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {health.map((repo) => (
            <div key={repo.id} className="premium-card p-6 group hover:scale-[1.02] transition-transform">
              <div className="flex justify-between items-start mb-4">
                <div className={`p-2 rounded-lg ${
                  repo.riskLevel === 'high' ? 'bg-red-500/10 text-red-500' :
                  repo.riskLevel === 'medium' ? 'bg-orange-500/10 text-orange-500' :
                  'bg-green-500/10 text-green-500'
                }`}>
                  {repo.riskLevel === 'high' ? <AlertTriangle size={16} /> : 
                   repo.riskLevel === 'medium' ? <Clock size={16} /> : 
                   <CheckCircle size={16} />}
                </div>
                {repo.isStale && (
                  <span className="bg-yellow-500/10 text-yellow-500 text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-widest">
                    {t('monitor.stale')}
                  </span>
                )}
              </div>
              <h3 className="text-white font-black uppercase tracking-tighter truncate mb-1">{repo.name}</h3>
              <p className="text-[10px] text-[var(--text-secondary)] font-bold uppercase tracking-widest italic mb-4">
                {t('monitor.last_seen')}: {repo.lastScan ? new Date(repo.lastScan).toLocaleDateString() : t('common.unknown')}
              </p>
              <div className="flex items-center justify-between pt-4 border-t border-[var(--border-subtle)]">
                <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic">
                  {t('dashboard.new_issues')}
                </span>
                <span className={`text-lg font-black italic ${
                  repo.openIssues > 0 ? 'text-orange-500' : 'text-green-500'
                }`}>
                  {repo.openIssues}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
