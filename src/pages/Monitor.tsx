import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Activity, Shield, AlertTriangle, CheckCircle, 
  Clock, RefreshCw, BarChart3, List, ChevronRight, ChevronDown, Server,
  TrendingUp, Layout, Zap, Settings, Bell
} from 'lucide-react';
import { 
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, Cell, BarChart, Bar
} from 'recharts';
import { monitorService } from '../services/monitorService';
import { client, databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';

export default function Monitor() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { getJWT } = useAuth();
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('24h');
  const [trends, setTrends] = useState<any[]>([]);
  const [health, setHealth] = useState<any[]>([]);
  const [findings, setFindings] = useState<any[]>([]);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [cpuThreshold, setCpuThreshold] = useState(85);
  const [incidentAlerts, setIncidentAlerts] = useState(true);
  const [slackWebhook, setSlackWebhook] = useState('');
  const [filter, setFilter] = useState('All');
  
  // Simulated infrastructure data
  const [infraData, setInfraData] = useState<any[]>([]);
  const [securityData, setSecurityData] = useState<any[]>([]);

  const fetchData = async () => {
    try {
      const token = await getJWT();
      const res = await fetch(`/api/monitor?range=${timeRange}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      
      setHealth(data.fleet || []);
      setFindings(data.findings_stream || []);
      setInfraData(data.infra_health || []);
      setSecurityData(data.security_events || []);
      
      // Update local metrics state if needed, or just use data directly in JSX
      setTrends(data.metrics || {}); 
      setLastUpdated(new Date());
    } catch (err) {
      console.error('[Monitor] Fetch failed:', err);
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
        if (response.events.some(e => e.includes('.create'))) {
          setFindings(prev => [response.payload, ...prev].slice(0, 10));
          toast.success(t('monitor.new_finding_detected'), { icon: '🔍' });
        }
      }
    );

    // Subscribe to scan status changes
    const unsubscribeScans = client.subscribe(
      `databases.${DB_ID}.collections.${COLLECTIONS.SCANS}.documents`,
      (response: any) => {
        if (response.events.some(e => e.includes('.update'))) {
          fetchData(); // Refresh health scorecards when a scan completes
        }
      }
    );

    const interval = setInterval(fetchData, 30000); 
    
    return () => {
      if (unsubscribeFindings) unsubscribeFindings();
      if (unsubscribeScans) unsubscribeScans();
      clearInterval(interval);
    };
  }, [timeRange]); // Re-fetch when time range changes

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <RefreshCw className="w-8 h-8 animate-spin text-[var(--accent-primary)]" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header & Time Range */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[var(--accent-primary)]/10 rounded-xl flex items-center justify-center border border-[var(--accent-primary)]/20 shadow-[0_0_15px_rgba(var(--accent-primary-rgb),0.1)]">
            <Activity className="text-[var(--accent-primary)] w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-[var(--text-primary)] uppercase tracking-tighter italic">
              System Telemetry
            </h1>
            <p className="text-[var(--text-secondary)] text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              Live Feed • {lastUpdated.toLocaleTimeString()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 p-1 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-subtle)]">
          {['15m', '1h', '24h', '7d'].map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${
                timeRange === range 
                  ? 'bg-[var(--accent-primary)] text-white shadow-lg' 
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {range === '15m' ? '15 Mins' : range === '1h' ? '1 Hour' : range === '24h' ? '24 Hours' : '7 Days'}
            </button>
          ))}
          <div className="w-px h-4 bg-[var(--border-subtle)] mx-1" />
          <button 
            onClick={() => fetchData()}
            disabled={loading}
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--accent-primary)] transition-all"
            title="Refresh Data"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Settings Panel - Permanent Fixture */}
      <div className="premium-card p-6 border-[var(--accent-primary)]/30">
        <h3 className="text-xs font-black uppercase tracking-widest mb-4 flex items-center gap-2">
          <AlertTriangle size={14} className="text-yellow-500" /> Alerting Thresholds
        </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">CPU Warning Threshold (%)</label>
              <input 
                type="range" min="50" max="95" value={cpuThreshold} 
                onChange={(e) => setCpuThreshold(parseInt(e.target.value))}
                className="w-full accent-[var(--accent-primary)]" 
              />
              <div className="flex justify-between text-[10px] font-black">
                <span>50%</span>
                <span className="text-[var(--accent-primary)]">{cpuThreshold}%</span>
                <span>95%</span>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-subtle)]">
              <div>
                <p className="text-[10px] font-black uppercase">Critical Incidents</p>
                <p className="text-[8px] text-[var(--text-secondary)] font-bold">Immediate push notifications</p>
              </div>
              <button 
                onClick={() => setIncidentAlerts(!incidentAlerts)}
                className={`w-10 h-5 rounded-full relative transition-all ${incidentAlerts ? 'bg-green-500' : 'bg-gray-400'}`}
              >
                <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${incidentAlerts ? 'right-1' : 'left-1'}`} />
              </button>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">Slack Webhook URL</label>
              <input 
                type="text" 
                placeholder="https://hooks.slack.com/..." 
                value={slackWebhook}
                onChange={(e) => setSlackWebhook(e.target.value)}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[10px] focus:border-[var(--accent-primary)] outline-none"
              />
            </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'Build Success Rate', value: `${trends?.success_rate || 0}%`, trend: 'Stable', color: 'var(--status-success)' },
          { label: 'Avg Scan Duration', value: `${trends?.avg_duration || 0}s`, trend: 'Optimizing', color: 'var(--accent-primary)' },
          { label: 'Finding Velocity', value: trends?.velocity || 'Stable', trend: 'Analysis Active', color: 'var(--status-success)' }
        ].map((m, i) => (
          <div key={i} className="premium-card p-4 flex justify-between items-center">
            {loading ? <div className="h-10 w-full animate-pulse bg-[var(--bg-secondary)] rounded-lg" /> : (
              <>
                <div>
                  <p className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-widest mb-1">{m.label}</p>
                  <p className="text-xl font-black text-[var(--text-primary)]">{m.value}</p>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1 text-[var(--status-success)] font-black text-[10px]">
                    <TrendingUp size={12} /> {m.trend}
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Telemetry Charts */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="premium-card p-4 h-[250px]">
              <h3 className="text-[10px] font-black uppercase tracking-widest mb-4 flex items-center gap-2">
                <Activity size={14} className="text-[var(--accent-primary)]" /> Infrastructure Health
              </h3>
              {loading ? <div className="w-full h-full animate-pulse bg-[var(--bg-secondary)] rounded-lg" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={infraData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                    <XAxis dataKey="name" hide />
                    <YAxis hide domain={[0, 100]} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'var(--bg-card)', border: 'none', borderRadius: '8px', fontSize: '10px' }}
                    />
                    <Line type="monotone" dataKey="cpu" stroke="#ff5252" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="mem" stroke="#40c4ff" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
              <div className="flex justify-center gap-4 mt-2">
                <div className="flex items-center gap-1 text-[8px] font-bold"><div className="w-2 h-2 bg-[#ff5252] rounded-full" /> CPU</div>
                <div className="flex items-center gap-1 text-[8px] font-bold"><div className="w-2 h-2 bg-[#40c4ff] rounded-full" /> MEM</div>
              </div>
            </div>

            <div className="premium-card p-4 h-[250px]">
              <h3 className="text-[10px] font-black uppercase tracking-widest mb-4 flex items-center gap-2">
                <Shield size={14} className="text-[var(--status-success)]" /> Security Events
              </h3>
              {loading ? <div className="w-full h-full animate-pulse bg-[var(--bg-secondary)] rounded-lg" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={securityData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                    <XAxis dataKey="name" hide />
                    <YAxis hide />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'var(--bg-card)', border: 'none', borderRadius: '8px', fontSize: '10px' }}
                    />
                    <Bar dataKey="alerts" fill="var(--accent-primary)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="blocked" fill="var(--status-success)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              )}
              <div className="flex justify-center gap-4 mt-2">
                <div className="flex items-center gap-1 text-[8px] font-bold"><div className="w-2 h-2 bg-[var(--accent-primary)] rounded-full" /> ALERTS</div>
                <div className="flex items-center gap-1 text-[8px] font-bold"><div className="w-2 h-2 bg-[var(--status-success)] rounded-full" /> BLOCKED</div>
              </div>
            </div>
          </div>

          {/* Fleet Health scorecards */}
          <div className="space-y-4">
            <h2 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-widest flex items-center gap-2">
              <div className="w-8 h-8 bg-emerald-500/10 rounded-lg flex items-center justify-center border border-emerald-500/20">
                <Server className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              Fleet Health Scorecards
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {loading ? [1, 2, 3, 4].map(i => <div key={i} className="h-24 w-full animate-pulse bg-[var(--bg-secondary)] rounded-xl" />) : health?.map((repo) => (
                <div key={repo.id} className="premium-card p-4 flex justify-between items-center hover:border-[var(--accent-primary)] transition-all cursor-default">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      repo.health === 'Critical' ? 'bg-red-500/10 text-red-500' :
                      repo.health === 'At Risk' ? 'bg-orange-500/10 text-orange-500' :
                      'bg-green-500/10 text-green-500'
                    }`}>
                      <Shield size={20} />
                    </div>
                    <div>
                      <p className="text-[12px] font-black text-[var(--text-primary)] uppercase truncate max-w-[150px]">{repo.name}</p>
                      <p className="text-[8px] font-bold text-[var(--text-secondary)] uppercase">
                        {repo.vulnerabilities} Issues • {repo.status}
                      </p>
                    </div>
                  </div>
                  <div className={`px-2 py-1 rounded text-[8px] font-black uppercase tracking-widest ${
                    repo.health === 'Critical' ? 'bg-red-500 text-white' :
                    repo.health === 'At Risk' ? 'bg-orange-500 text-white' :
                    'bg-green-500 text-white'
                  }`}>
                    {repo.health}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Real-time Finding Stream */}
        <div className="premium-card p-4 flex flex-col h-full min-h-[500px]">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-widest flex items-center gap-2">
              <Clock size={16} className="text-[var(--accent-primary)]" /> Pipeline Stream
            </h2>
            <div className="flex bg-[var(--bg-secondary)] p-1 rounded-lg gap-1">
              {['All', 'Errors', 'Warnings'].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 text-[8px] font-black uppercase tracking-widest rounded-md transition-all ${
                    filter === f 
                      ? 'bg-[var(--accent-primary)] text-white shadow-lg' 
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 overflow-y-auto max-h-[580px] pr-2 custom-scrollbar scrollbar-thin scrollbar-thumb-zinc-700">
            {loading ? [1, 2, 3, 4, 5].map(i => <div key={i} className="h-20 w-full animate-pulse bg-[var(--bg-secondary)] rounded-xl" />) : (
              (() => {
                const filtered = findings?.filter(f => {
                  if (filter === 'All') return true;
                  if (filter === 'Errors') return f.severity === 'critical' || f.severity === 'high';
                  if (filter === 'Warnings') return f.severity === 'medium';
                  return true;
                });

                if (filtered?.length === 0) {
                  return (
                    <div className="text-center py-20">
                      <Activity size={32} className="mx-auto text-gray-300 mb-4 animate-pulse" />
                      <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">No {filter} Found</p>
                    </div>
                  );
                }

                return filtered?.map((f) => (
                  <div key={f.id} className="p-3 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/50 transition-all group relative overflow-hidden">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 flex-1">
                        <span className={`px-2 py-0.5 rounded text-[7px] font-black uppercase tracking-widest whitespace-nowrap ${
                          f.severity === 'critical' ? 'bg-red-500 text-white' :
                          f.severity === 'high' ? 'bg-orange-500 text-white' :
                          'bg-blue-500 text-white'
                        }`}>
                          {f.severity}
                        </span>
                        <div className="min-w-0">
                          <p className="text-[10px] font-black text-[var(--text-primary)] truncate leading-tight">{f.title}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <p className="text-[7px] font-bold text-[var(--text-secondary)] uppercase tracking-tighter truncate max-w-[100px]">{f.repo}</p>
                            <span className="text-[7px] text-[var(--text-secondary)] font-mono opacity-50">
                              {new Date(f.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button 
                        onClick={() => navigate('/chat', { state: { initialMessage: `Help me remediate this ${f.severity} finding: "${f.title}" on repository ${f.repo}. Error context: ${f.message}` } })}
                        className="px-3 py-1.5 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] text-[8px] font-black uppercase tracking-widest rounded-lg border border-[var(--accent-primary)]/20 hover:bg-[var(--accent-primary)] hover:text-white transition-all flex items-center gap-1 shrink-0"
                      >
                        <Zap size={10} /> Ask
                      </button>
                    </div>
                  </div>
                ));
              })()
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
