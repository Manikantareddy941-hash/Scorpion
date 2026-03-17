import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Shield, AlertTriangle, Bug, Wind, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface Finding {
  severity: string;
  tool: string;
  message: string;
  file_path: string;
  line_number?: number;
}

const severityColor: Record<string, string> = {
  CRITICAL: '#ff2200', HIGH: '#E8440A', MEDIUM: '#ffaa00', LOW: '#888', INFO: '#666'
};

export default function ScanResults() {
  const location = useLocation();
  const navigate = useNavigate();
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
        
        // 1. Fetch Scan Details
        const detailsRes = await fetch(`${apiBase}/api/repos/scans/${scanId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const detailsData = await detailsRes.json();
        setDetails(detailsData.details);

        // 2. Fetch Findings
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
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <Shield className="w-12 h-12 text-orange-500 animate-pulse mx-auto mb-4" />
          <p style={{ color: '#E8440A', fontWeight: 800, letterSpacing: '0.1em' }}>RETRIEVING AUDIT DATA...</p>
        </div>
      </div>
    );
  }

  const stats = [
    { label: 'CRITICAL', value: findings.filter(f => f.severity === 'CRITICAL').length, color: '#ff2200', icon: Shield },
    { label: 'HIGH', value: findings.filter(f => f.severity === 'HIGH').length, color: '#E8440A', icon: AlertTriangle },
    { label: 'MEDIUM', value: findings.filter(f => f.severity === 'MEDIUM').length, color: '#ffaa00', icon: Bug },
    { label: 'LOW/INFO', value: findings.filter(f => ['LOW', 'INFO'].includes(f.severity)).length, color: '#888', icon: Wind },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: '32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h1 style={{ color: '#E8440A', fontWeight: 800, fontSize: '1.4rem', letterSpacing: '0.1em', margin: 0 }}>SCAN RESULTS</h1>
          <p style={{ color: '#666', fontSize: '0.8rem', margin: '4px 0 0' }}>TARGET: {scanTarget}</p>
        </div>
        <button onClick={() => navigate('/')} style={{ background: '#E8440A', border: 'none', borderRadius: '8px', padding: '10px 20px', color: 'white', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.1em' }}>
          ← DASHBOARD
        </button>
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
        {[
          { label: 'TOTAL FINDINGS', value: findings.length },
          { label: 'SECURITY SCORE', value: details?.security_score || 'N/A' },
          { label: 'LANGUAGE', value: details?.language || 'Unknown' },
          { label: 'SCAN COMPLETED', value: details?.completed_at ? new Date(details.completed_at).toLocaleTimeString() : 'N/A' },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '20px' }}>
            <div style={{ color: '#666', fontSize: '0.7rem', letterSpacing: '0.1em' }}>{label}</div>
            <div style={{ color: 'var(--text-primary)', fontWeight: 800, fontSize: '1.4rem', marginTop: '8px' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
        {stats.map(({ label, value, color, icon: Icon }) => (
          <div key={label} style={{ background: 'var(--bg-card)', border: `1px solid ${color}33`, borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <Icon size={20} color={color} style={{ marginBottom: '8px' }} />
            <div style={{ color, fontWeight: 800, fontSize: '1.5rem' }}>{value}</div>
            <div style={{ color: '#666', fontSize: '0.65rem', letterSpacing: '0.08em', marginTop: '4px' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Issues Table */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.9rem', letterSpacing: '0.1em', margin: 0 }}>DETECTED ISSUES</h2>
          <span style={{ color: '#444', fontSize: '0.7rem', fontWeight: 600 }}>{findings.length} FINDINGS TOTAL</span>
        </div>
        {findings.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#666' }}>
            <CheckCircle2 size={48} color="#22c55e" style={{ margin: '0 auto 16px', display: 'block' }} />
            <p style={{ fontWeight: 800, letterSpacing: '0.1em' }}>NO ISSUES DETECTED</p>
            <p style={{ fontSize: '0.8rem' }}>Your code meets the security baseline.</p>
          </div>
        ) : (
          findings.map((issue, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '100px 100px 1fr auto', gap: '16px', padding: '16px 24px', borderBottom: '1px solid var(--border-subtle)', alignItems: 'center' }}>
              <span style={{ color: severityColor[issue.severity] || '#666', fontWeight: 700, fontSize: '0.75rem', letterSpacing: '0.08em' }}>{issue.severity}</span>
              <span style={{ color: '#666', fontSize: '0.75rem', textTransform: 'uppercase', fontFamily: 'monospace' }}>{issue.tool}</span>
              <div>
                <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 500 }}>{issue.message}</div>
                <div style={{ color: '#444', fontSize: '0.75rem', fontFamily: 'monospace', marginTop: '2px' }}>{issue.file_path}{issue.line_number ? `:${issue.line_number}` : ''}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
