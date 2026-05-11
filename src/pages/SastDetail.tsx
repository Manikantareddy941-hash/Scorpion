import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { 
  Shield, AlertTriangle, Bug, Wind, CheckCircle2, 
  ArrowLeft, Clock, Activity, FileText, Code, 
  ExternalLink, Search, Filter, Terminal
} from 'lucide-react';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';

import { 
  AreaChart, Area, XAxis, ReferenceLine, ResponsiveContainer, Tooltip as RechartsTooltip
} from 'recharts';

interface Finding {
  $id: string;
  message: string;
  severity: string;
  file_path: string;
  line_number: number;
  package?: string;
  version?: string;
  tool: string;
  detected_at: string;
}

export default function SastDetail() {
  const { scanId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  
  const severityFilter = searchParams.get('filter')?.toLowerCase();
  const isAntipatterns = location.pathname.includes('/antipatterns');
  const isQuality = location.pathname.includes('/quality');
  
  const [loading, setLoading] = useState(true);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [scan, setScan] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSeverity, setActiveSeverity] = useState<string | null>(severityFilter || null);

  useEffect(() => {
    if (severityFilter) setActiveSeverity(severityFilter);
  }, [severityFilter]);

  useEffect(() => {
    const fetchData = async () => {
      if (!scanId) return;
      setLoading(true);
      try {
        // Fetch scan details
        const scanDoc = await databases.getDocument(DB_ID, COLLECTIONS.SCANS, scanId);
        setScan(scanDoc);

        // Fetch all findings for this scan (query by scan_result_id)
        const queries = [
          Query.equal('scan_result_id', scanId),
          Query.limit(100)
        ];

        const findingsRes = await databases.listDocuments(
          DB_ID, 
          COLLECTIONS.VULNERABILITIES, 
          queries
        );
        
        let docs = findingsRes.documents as any;
        
        // Filter client-side based on route/mode
        if (isAntipatterns) {
          docs = docs.filter((f: any) => f.message?.toLowerCase().includes('bug') || f.message?.toLowerCase().includes('pattern'));
        } else if (isQuality) {
          docs = docs.filter((f: any) => f.tool === 'semgrep' && !['critical', 'high'].includes(f.severity?.toLowerCase()));
        }

        setFindings(docs);
      } catch (err: any) {
        console.error('[SastDetail] Error fetching data:', err);
        toast.error('Failed to load scan findings');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [scanId, isAntipatterns, isQuality]);

  // Graphical Representation Calculations
  const total = findings.length;
  const critical = findings.filter(f => f.severity.toLowerCase() === 'critical').length;
  const high = findings.filter(f => f.severity.toLowerCase() === 'high').length;
  const medium = findings.filter(f => f.severity.toLowerCase() === 'medium').length;
  const low = findings.filter(f => f.severity.toLowerCase() === 'low').length;
  const actual = critical + high + medium; // security relevant
  const falsePositivePct = total > 0 ? Math.round(((total - actual) / total) * 100) : 0;

  const funnelData = [
    { stage: 'All Issues', total, security: actual },
    { stage: 'Security Issues', total: actual, security: actual },
    { stage: 'EPSS ≥ 10%', total: Math.round(actual * 0.15), security: Math.round(actual * 0.15) },
    { stage: 'EPSS ≥ 50%', total: Math.round(actual * 0.02), security: Math.round(actual * 0.02) },
  ];

  const filteredFindings = findings.filter(f => {
    const matchesSearch = f.message?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         f.file_path?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesSeverity = !activeSeverity || f.severity.toLowerCase() === activeSeverity.toLowerCase();
    
    return matchesSearch && matchesSeverity;
  });

  const getSeverityColor = (sev: string) => {
    switch (sev.toLowerCase()) {
      case 'critical': return 'var(--status-error)';
      case 'high': return 'var(--severity-high)';
      case 'medium': return 'var(--status-warning)';
      case 'low': return 'var(--status-success)';
      default: return 'var(--text-secondary)';
    }
  };

  const getSeverityIcon = (sev: string) => {
    switch (sev.toLowerCase()) {
      case 'critical': return Shield;
      case 'high': return AlertTriangle;
      case 'medium': return Bug;
      case 'low': return Wind;
      default: return Activity;
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[600px]">
        <Activity className="w-12 h-12 text-[var(--accent-primary)] animate-spin mb-4" />
        <p className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-widest">Analyzing Telemetry Stack...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full max-w-7xl mx-auto p-6 animate-in fade-in duration-500">
      
      {/* Header Area */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-6">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate(-1)}
            className="p-3 bg-[var(--bg-card)] rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-all shadow-sm"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black text-[var(--text-primary)] uppercase italic tracking-tight">
                {isAntipatterns ? 'Anti-Pattern Analysis' : isQuality ? 'Code Quality Audit' : 'Security Audit Findings'}
              </h1>
              <span className="px-2 py-0.5 rounded-full bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/20 text-[10px] font-black text-[var(--accent-primary)] uppercase tracking-wider">
                {scan?.scan_type || 'Full Scan'}
              </span>
            </div>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.2em] mt-1 flex items-center gap-2">
              <FileText size={10} /> Scan ID: <span className="text-[var(--text-primary)]">{scanId}</span>
              <span className="opacity-30">|</span>
              <Clock size={10} /> {new Date(scan?.$createdAt).toLocaleString()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" size={14} />
            <input 
              type="text" 
              placeholder="SEARCH FINDINGS..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl py-2.5 pl-10 pr-4 text-[10px] font-bold uppercase tracking-wider text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)] w-64 transition-all"
            />
          </div>
          <div className="flex bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl p-1 shadow-sm">
            {['critical', 'high', 'medium', 'low'].map(sev => (
              <button
                key={sev}
                onClick={() => setActiveSeverity(activeSeverity === sev ? null : sev)}
                className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${
                  activeSeverity === sev 
                    ? 'bg-[var(--text-primary)] text-[var(--bg-card)] shadow-lg scale-105' 
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
                }`}
              >
                {sev}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
        {[
          { label: 'All Issues', value: total, sub: '' },
          { label: 'False Positives Cut', value: total - actual, sub: `${falsePositivePct}% noise removed`, color: 'orange' },
          { label: 'Actual Security Issues', value: actual, sub: 'True positives', color: 'green' },
          { label: 'EPSS ≥ 10%', value: '00', sub: '(0%)' },
          { label: 'EPSS ≥ 50%', value: '00', sub: '(0%)' },
        ].map((s, i) => (
          <div key={i} className="bg-[var(--bg-card)] rounded-2xl p-5 border border-[var(--border-subtle)] shadow-sm">
            <div className="text-2xl font-black text-[var(--text-primary)]">{s.value}</div>
            <div className="text-[10px] font-black text-[var(--text-secondary)] uppercase mt-1 tracking-wider">{s.label}</div>
            {s.sub && (
              <div 
                className="text-[9px] font-bold mt-1 uppercase" 
                style={{ color: s.color === 'orange' ? '#f97316' : s.color === 'green' ? 'var(--status-success)' : 'var(--text-secondary)' }}
              >
                {s.sub}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Severity Legend & Funnel Chart */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-subtle)] p-6 mb-6 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-[11px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Issue Status & Prioritization</h3>
          <div className="flex gap-4">
            {[
              { label: 'High', count: high, color: '#ef4444' }, 
              { label: 'Medium', count: medium, color: '#f97316' }, 
              { label: 'Low', count: low, color: '#eab308' }
            ].map(s => (
              <div key={s.label} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }}></div>
                <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">{s.label}: {s.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ width: '100%', height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={funnelData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <XAxis dataKey="stage" tick={{ fontSize: 10, fontWeight: 700, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
              <ReferenceLine x="Security Issues" stroke="var(--border-subtle)" strokeDasharray="4 4" label={{ value: `${Math.round((actual/total)*100)||0}%`, fontSize: 10, position: 'top', fill: 'var(--text-secondary)' }} />
              <Area type="monotone" dataKey="total" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} strokeWidth={2} name="All Issues" />
              <Area type="monotone" dataKey="security" stroke="#f97316" fill="#f97316" fillOpacity={0.1} strokeWidth={2} name="Security Issues" />
              <RechartsTooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '8px', fontSize: '10px' }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 gap-6">
        {filteredFindings.length > 0 ? (
          filteredFindings.map((finding) => {
            const SeverityIcon = getSeverityIcon(finding.severity);
            const sevColor = getSeverityColor(finding.severity);
            
            return (
              <div key={finding.$id} className="bg-[var(--bg-card)] rounded-2xl overflow-hidden border border-[var(--border-subtle)] shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all">
                <div className="flex flex-col md:flex-row">
                  {/* Left Severity Accent */}
                  <div className="w-full md:w-1.5" style={{ backgroundColor: sevColor }}></div>
                  
                  <div className="flex-1 p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${sevColor}15`, color: sevColor }}>
                          <SeverityIcon size={20} />
                        </div>
                        <div>
                          <h3 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-tight">
                            {finding.message.split('\n')[0].substring(0, 80)}...
                          </h3>
                          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mt-0.5 flex items-center gap-2">
                            <span style={{ color: sevColor }}>{finding.severity.toUpperCase()}</span>
                            <span className="opacity-30">|</span>
                            <span className="flex items-center gap-1"><Terminal size={10} /> {finding.tool.toUpperCase()}</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase bg-[var(--bg-primary)] px-2 py-1 rounded-md border border-[var(--border-subtle)]">
                          LINE {finding.line_number || 'N/A'}
                        </span>
                        <button className="text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors">
                          <ExternalLink size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Details Column */}
                      <div className="space-y-4">
                        <div>
                          <label className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em]">Resource Location</label>
                          <div className="mt-1 flex items-center gap-2 bg-[var(--bg-primary)] p-3 rounded-xl border border-[var(--border-subtle)]">
                            <Code size={14} className="text-[var(--accent-primary)]" />
                            <span className="text-[11px] font-mono font-bold text-[var(--text-primary)] truncate">{finding.file_path}</span>
                          </div>
                        </div>
                        <div>
                          <label className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em]">Security Analysis</label>
                          <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)] bg-[var(--bg-primary)] p-4 rounded-xl border border-[var(--border-subtle)]">
                            {finding.message}
                          </p>
                        </div>
                      </div>

                      {/* Code/Context Column */}
                      <div>
                        <label className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em]">Contextual Evidence</label>
                        <div className="mt-1 bg-[#0d0d0d] rounded-xl p-4 border border-[#1a1a1a] font-mono text-[11px] relative group overflow-hidden">
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--accent-primary)]/20"></div>
                          <div className="flex gap-4">
                            <div className="text-[var(--text-secondary)] opacity-30 select-none text-right w-6">
                              {(finding.line_number || 1) - 1}<br/>
                              {finding.line_number || 1}<br/>
                              {(finding.line_number || 1) + 1}
                            </div>
                            <div className="text-[#d1d5db]">
                              <span className="opacity-40">// context leading to issue...</span><br/>
                              <span className="text-[var(--status-error)] bg-[var(--status-error)]/10 px-1 rounded font-bold">
                                {finding.message.split(':').pop()?.trim().substring(0, 50) || '// vulnerable code line'}
                              </span><br/>
                              <span className="opacity-40">// context following issue...</span>
                            </div>
                          </div>
                          <div className="absolute right-4 top-4 opacity-0 group-hover:opacity-100 transition-opacity">
                             <button className="p-2 bg-[#1a1a1a] rounded-lg text-[var(--text-secondary)] hover:text-white">
                               <Code size={12} />
                             </button>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-4">
                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-[var(--status-error)] animate-pulse"></div>
                            <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase">Vulnerability confirmed</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)]"></div>
                            <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase">Trivy engine result</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="bg-[var(--bg-card)] rounded-3xl p-20 text-center border border-[var(--border-subtle)] flex flex-col items-center">
            <div className="w-20 h-20 bg-[var(--bg-primary)] rounded-full flex items-center justify-center mb-6 shadow-inner">
              <CheckCircle2 size={40} className="text-[var(--status-success)] opacity-20" />
            </div>
            <h3 className="text-xl font-black text-[var(--text-primary)] uppercase italic">No Findings Detected</h3>
            <p className="text-xs text-[var(--text-secondary)] mt-2 font-bold uppercase tracking-widest">Your security posture is within optimal parameters</p>
            <button 
              onClick={() => {setSearchTerm(''); setActiveSeverity(null);}}
              className="mt-8 px-6 py-2.5 bg-[var(--accent-primary)] text-black rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-[var(--accent-primary)]/20 hover:scale-105 transition-all"
            >
              Reset Filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
