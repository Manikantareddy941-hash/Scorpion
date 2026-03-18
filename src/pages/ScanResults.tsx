import { useEffect, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Shield, AlertTriangle, Bug, Wind, CheckCircle2, ArrowLeft, Terminal, Clock, Activity } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface Finding {
  severity: string;
  tool: string;
  message: string;
  file_path: string;
  line_number?: number;
}

export default function ScanResults() {
  const location = useLocation();
  const { getJWT } = useAuth();
  
  const scanTarget = location.state?.scanTarget || 'Unknown';
  const scanId = location.state?.scanId;

  const [findings, setFindings] = useState<Finding[]>([]);
  const [details, setDetails] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!scanId) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
        const token = await getJWT();
        
        const detailsRes = await fetch(`${apiBase}/api/repos/scans/${scanId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const detailsData = await detailsRes.json();
        setDetails(detailsData.details);

        const findingsRes = await fetch(`${apiBase}/api/findings/scans/${scanId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const findingsData = await findingsRes.json();
        setFindings(findingsData.map((f: any) => ({
          severity: f.severity.toUpperCase(),
          tool: f.tool,
          message: f.message,
          file_path: f.file_path,
          line_number: f.line_number
        })));

      } catch (err) {
        console.error('Failed to fetch scan results:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [scanId, getJWT]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center p-8">
        <div className="text-center">
          <Shield className="w-12 h-12 text-[var(--accent-primary)] animate-pulse mx-auto mb-4" />
          <h2 className="text-xs font-black text-[var(--text-secondary)] uppercase tracking-widest animate-pulse italic leading-none">Retrieving Audit Data...</h2>
        </div>
      </div>
    );
  }

  const stats = [
    { label: 'CRITICAL', value: findings.filter(f => f.severity === 'CRITICAL').length, color: 'var(--severity-critical)', icon: Shield },
    { label: 'HIGH', value: findings.filter(f => f.severity === 'HIGH').length, color: 'var(--severity-high)', icon: AlertTriangle },
    { label: 'MEDIUM', value: findings.filter(f => f.severity === 'MEDIUM').length, color: 'var(--severity-medium)', icon: Bug },
    { label: 'LOW/INFO', value: findings.filter(f => ['LOW', 'INFO'].includes(f.severity)).length, color: 'var(--severity-low)', icon: Wind },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] p-8 text-[var(--text-primary)] transition-colors duration-300">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-12 gap-6">
          <div className="flex items-center gap-5">
            <div className="w-14 h-14 bg-[var(--accent-primary)] rounded-2xl flex items-center justify-center text-white shadow-xl shadow-[var(--accent-primary)]/20">
                <Activity className="w-7 h-7" />
            </div>
            <div>
                <h1 className="text-3xl font-black tracking-tighter italic uppercase leading-none">Scan Results</h1>
                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.2em] mt-1 italic font-mono truncate max-w-[300px]">TARGET: {scanTarget}</p>
            </div>
          </div>
          <Link to="/" className="btn-premium flex items-center gap-2 self-start md:self-auto">
            <ArrowLeft className="w-4 h-4" />
            Back to Control
          </Link>
        </div>

        {/* Summary Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {[
            { label: 'Total Findings', value: findings.length, icon: Bug },
            { label: 'Security Score', value: `${details?.security_score || 'N/A'}%`, icon: Shield },
            { label: 'Language', value: details?.language || 'Unknown', icon: Terminal },
            { label: 'Scan Completed', value: details?.completed_at ? new Date(details.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A', icon: Clock },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="premium-card p-6 group">
              <div className="flex items-center gap-3 mb-2">
                <Icon className="w-4 h-4 text-[var(--text-secondary)] group-hover:text-[var(--accent-primary)] transition-colors" />
                <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic">{label}</span>
              </div>
              <div className="text-2xl font-black italic tracking-tighter truncate">{value}</div>
            </div>
          ))}
        </div>

        {/* Severity Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
          {stats.map(({ label, value, color, icon: Icon }) => (
            <div key={label} className="premium-card p-5 text-center group border-opacity-20" style={{ borderColor: `${color}33` }}>
              <Icon className="w-6 h-6 mx-auto mb-3 transition-transform group-hover:scale-110" style={{ color }} />
              <div className="text-3xl font-black italic tracking-tighter mb-1" style={{ color }}>{value}</div>
              <div className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic">{label}</div>
            </div>
          ))}
        </div>

        {/* Findings List */}
        <div className="premium-card overflow-hidden">
          <div className="p-8 border-b border-[var(--border-subtle)] bg-[var(--text-primary)]/5 flex justify-between items-center">
            <h2 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-widest italic">Detected Issues</h2>
            <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic bg-[var(--bg-secondary)] px-3 py-1 rounded-full border border-[var(--border-subtle)]">{findings.length} Findings</span>
          </div>
          
          <div className="divide-y divide-[var(--border-subtle)]">
            {findings.length === 0 ? (
              <div className="p-20 text-center flex flex-col items-center justify-center">
                <CheckCircle2 className="w-12 h-12 text-[var(--status-success)] mb-4 animate-bounce" />
                <p className="text-[var(--text-secondary)] font-black uppercase tracking-[0.2em] text-xs italic">No vulnerabilities identified. Code is secure.</p>
              </div>
            ) : (
              findings.map((issue, i) => (
                <div key={i} className="p-6 hover:bg-[var(--text-primary)]/5 transition-all group flex flex-col md:flex-row md:items-center gap-6">
                  <div className="flex items-center gap-4 min-w-[140px]">
                    <span 
                      className="px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest italic border bg-opacity-10"
                      style={{ 
                        color: issue.severity === 'LOW' || issue.severity === 'INFO' ? 'var(--text-secondary)' : `var(--severity-${issue.severity.toLowerCase()})`,
                        borderColor: issue.severity === 'LOW' || issue.severity === 'INFO' ? 'var(--border-subtle)' : `var(--severity-${issue.severity.toLowerCase()})44`,
                        backgroundColor: issue.severity === 'LOW' || issue.severity === 'INFO' ? 'var(--bg-secondary)' : `var(--severity-${issue.severity.toLowerCase()})11`
                      }}
                    >
                      {issue.severity}
                    </span>
                    <span className="text-[9px] font-mono text-[var(--text-secondary)] uppercase font-bold tracking-widest">[{issue.tool}]</span>
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--text-primary)] font-black text-lg tracking-tight mb-1 uppercase italic leading-tight group-hover:text-[var(--accent-primary)] transition-colors">{issue.message}</div>
                    <div className="text-[var(--text-secondary)] opacity-60 text-[10px] font-mono uppercase tracking-tight flex items-center gap-2">
                      <Terminal className="w-3 h-3" />
                      {issue.file_path}{issue.line_number ? `:${issue.line_number}` : ''}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
