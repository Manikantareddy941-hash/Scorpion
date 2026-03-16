import { useLocation, useNavigate } from 'react-router-dom';
import { Shield, AlertTriangle, Bug, Copy, Wind } from 'lucide-react';

const mockResults = {
  summary: { totalFiles: 48, linesScanned: 12840, language: 'TypeScript', scanDuration: '4.2s' },
  stats: [
    { label: 'VULNERABILITIES', value: 7, color: '#ff2200', icon: Shield },
    { label: 'SECURITY ISSUES', value: 3, color: '#E8440A', icon: AlertTriangle },
    { label: 'BUGS', value: 12, color: '#ffaa00', icon: Bug },
    { label: 'CODE SMELLS', value: 24, color: '#888', icon: Wind },
    { label: 'DUPLICATES', value: 5, color: '#4488ff', icon: Copy },
    { label: 'WARNINGS', value: 18, color: '#ffcc00', icon: AlertTriangle },
  ],
  issues: [
    { severity: 'CRITICAL', type: 'Vulnerability', file: 'src/lib/auth.ts', line: 42, message: 'SQL injection vulnerability detected in query builder' },
    { severity: 'CRITICAL', type: 'Security', file: 'src/api/users.ts', line: 18, message: 'Hardcoded API key exposed in source code' },
    { severity: 'HIGH', type: 'Bug', file: 'src/components/Dashboard.tsx', line: 156, message: 'Potential null pointer dereference' },
    { severity: 'HIGH', type: 'Vulnerability', file: 'src/utils/crypto.ts', line: 8, message: 'Weak encryption algorithm (MD5) used for password hashing' },
    { severity: 'MEDIUM', type: 'Code Smell', file: 'src/pages/Reports.tsx', line: 203, message: 'Function exceeds 50 lines, consider refactoring' },
    { severity: 'MEDIUM', type: 'Duplicate', file: 'src/components/Card.tsx', line: 12, message: 'Duplicate code block found in 3 locations' },
    { severity: 'LOW', type: 'Warning', file: 'src/hooks/useAuth.ts', line: 34, message: 'Unused variable detected' },
  ]
};

const severityColor: Record<string, string> = {
  CRITICAL: '#ff2200', HIGH: '#E8440A', MEDIUM: '#ffaa00', LOW: '#666'
};

export default function ScanResults() {
  const location = useLocation();
  const navigate = useNavigate();
  const scanTarget = location.state?.scanTarget || 'Unknown';

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
          { label: 'FILES SCANNED', value: mockResults.summary.totalFiles },
          { label: 'LINES OF CODE', value: mockResults.summary.linesScanned.toLocaleString() },
          { label: 'LANGUAGE', value: mockResults.summary.language },
          { label: 'SCAN TIME', value: mockResults.summary.scanDuration },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '20px' }}>
            <div style={{ color: '#666', fontSize: '0.7rem', letterSpacing: '0.1em' }}>{label}</div>
            <div style={{ color: 'var(--text-primary)', fontWeight: 800, fontSize: '1.4rem', marginTop: '8px' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px', marginBottom: '24px' }}>
        {mockResults.stats.map(({ label, value, color, icon: Icon }) => (
          <div key={label} style={{ background: 'var(--bg-card)', border: `1px solid ${color}33`, borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <Icon size={20} color={color} style={{ marginBottom: '8px' }} />
            <div style={{ color, fontWeight: 800, fontSize: '1.5rem' }}>{value}</div>
            <div style={{ color: '#666', fontSize: '0.65rem', letterSpacing: '0.08em', marginTop: '4px' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Issues Table */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
          <h2 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.9rem', letterSpacing: '0.1em', margin: 0 }}>DETECTED ISSUES</h2>
        </div>
        {mockResults.issues.map((issue, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '100px 100px 1fr auto', gap: '16px', padding: '16px 24px', borderBottom: '1px solid var(--border-subtle)', alignItems: 'center' }}>
            <span style={{ color: severityColor[issue.severity], fontWeight: 700, fontSize: '0.75rem', letterSpacing: '0.08em' }}>{issue.severity}</span>
            <span style={{ color: '#666', fontSize: '0.75rem' }}>{issue.type}</span>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem' }}>{issue.message}</div>
              <div style={{ color: '#444', fontSize: '0.75rem', fontFamily: 'monospace', marginTop: '2px' }}>{issue.file}:{issue.line}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
