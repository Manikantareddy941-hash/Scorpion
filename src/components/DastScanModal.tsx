import { useEffect, useRef, useState } from 'react';
import { X, Loader2, Globe, Zap, Radar, Crosshair } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

interface Props {
  onClose: () => void;
}

type Scanner = 'zap' | 'nuclei' | 'ffuf';
type ScanMode = 'spider' | 'active' | 'passive';

// Endpoint + request-body shape per scanner. Status path derives from the id
// returned by the start call. Mirrors the backend routes added in Phases 1-3.
const SCANNERS: Record<Scanner, { label: string; icon: typeof Zap; start: string; status: (id: string) => string }> = {
  zap: { label: 'ZAP (DAST)', icon: Zap, start: '/api/scan/dast/dast', status: (id) => `/api/scan/dast/dast/${id}/status` },
  nuclei: { label: 'Nuclei', icon: Radar, start: '/api/scan/nuclei', status: (id) => `/api/scan/nuclei/${id}/status` },
  ffuf: { label: 'ffuf (fuzz)', icon: Crosshair, start: '/api/scan/ffuf', status: (id) => `/api/scan/ffuf/${id}/status` },
};

const POLL_INTERVAL_MS = 3000;

export default function DastScanModal({ onClose }: Props) {
  const { getJWT } = useAuth();
  const [scanner, setScanner] = useState<Scanner>('zap');
  const [targetUrl, setTargetUrl] = useState('');
  const [scanMode, setScanMode] = useState<ScanMode>('active');
  const [bearerToken, setBearerToken] = useState('');
  const [tags, setTags] = useState('');
  const [rate, setRate] = useState('40');
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stop polling if the modal unmounts mid-scan.
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const buildBody = (): Record<string, unknown> => {
    if (scanner === 'zap') {
      return { target_url: targetUrl.trim(), scanMode, ...(bearerToken.trim() ? { auth: { bearerToken: bearerToken.trim() } } : {}) };
    }
    if (scanner === 'nuclei') {
      return { target_url: targetUrl.trim(), ...(tags.trim() ? { tags: tags.trim() } : {}) };
    }
    return { target_url: targetUrl.trim(), ...(rate.trim() ? { rate: Number(rate) } : {}) };
  };

  const pollStatus = (scanId: string, token: string) => {
    const spec = SCANNERS[scanner];
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(spec.status(scanId), { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        setStatusText(data.status);
        if (data.status === 'completed') {
          if (pollRef.current) clearInterval(pollRef.current);
          setLoading(false);
          toast.success(`${SCANNERS[scanner].label} scan complete`);
        } else if (data.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          setLoading(false);
          const detail = data.details?.error ? `: ${data.details.error}` : '';
          setError(`Scan failed${detail}`);
          toast.error('DAST scan failed');
        }
      } catch {
        // Transient poll error — keep polling; a persistent failure surfaces via the scan status.
      }
    }, POLL_INTERVAL_MS);
  };

  const handleRun = async () => {
    if (!targetUrl.trim()) return;
    setLoading(true);
    setError(null);
    setStatusText('starting');
    try {
      const token = await getJWT();
      if (!token) throw new Error('Authentication required');

      const res = await fetch(SCANNERS[scanner].start, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(buildBody()),
      });
      const data = await res.json();
      if (!res.ok || !data.scanId) throw new Error(data.error || 'Failed to start scan');

      setStatusText('running');
      toast.success(`${SCANNERS[scanner].label} scan started`);
      pollStatus(data.scanId, token);
    } catch (err) {
      setLoading(false);
      setStatusText(null);
      setError(err instanceof Error ? err.message : 'Failed to start scan');
    }
  };

  const labelStyle = { color: 'var(--text-secondary)', fontSize: '0.75rem', letterSpacing: '0.1em', display: 'block', marginBottom: '8px' } as const;
  const inputStyle = { width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '12px', color: 'var(--text-primary)', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' } as const;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '16px', width: '520px', maxWidth: '95vw', padding: '32px', position: 'relative' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <h2 style={{ color: 'var(--accent-primary)', fontWeight: 800, fontSize: '1.2rem', letterSpacing: '0.1em', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Globe size={18} /> DAST SCAN
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '4px 0 0' }}>
              Scan a running target with ZAP, Nuclei, or ffuf
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={20} /></button>
        </div>

        {/* Scanner picker */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          {(Object.keys(SCANNERS) as Scanner[]).map((s) => {
            const Icon = SCANNERS[s].icon;
            const active = scanner === s;
            return (
              <button key={s} onClick={() => { setScanner(s); setError(null); }} disabled={loading}
                style={{ flex: 1, padding: '10px', borderRadius: '8px', border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-subtle)'}`, background: active ? 'var(--accent-primary)0D' : 'transparent', color: active ? 'var(--accent-primary)' : 'var(--text-secondary)', fontWeight: 700, fontSize: '0.72rem', letterSpacing: '0.05em', cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                <Icon size={14} /> {SCANNERS[s].label}
              </button>
            );
          })}
        </div>

        {/* Target URL */}
        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>TARGET URL</label>
          <input type="text" placeholder="https://staging.example.com" value={targetUrl} disabled={loading}
            onChange={(e) => { setTargetUrl(e.target.value); setError(null); }} style={inputStyle} />
        </div>

        {/* ZAP: scan mode + optional bearer token */}
        {scanner === 'zap' && (
          <>
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>SCAN MODE</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {(['spider', 'active', 'passive'] as ScanMode[]).map((m) => (
                  <button key={m} onClick={() => setScanMode(m)} disabled={loading}
                    style={{ flex: 1, padding: '10px', borderRadius: '8px', border: `1px solid ${scanMode === m ? 'var(--accent-primary)' : 'var(--border-subtle)'}`, background: scanMode === m ? 'var(--accent-primary)0D' : 'transparent', color: scanMode === m ? 'var(--accent-primary)' : 'var(--text-secondary)', fontWeight: 700, fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', cursor: loading ? 'not-allowed' : 'pointer' }}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>BEARER TOKEN <span style={{ opacity: 0.5 }}>(optional — scan behind auth)</span></label>
              <input type="password" placeholder="eyJhbGciOi..." value={bearerToken} disabled={loading}
                onChange={(e) => setBearerToken(e.target.value)} style={inputStyle} />
            </div>
          </>
        )}

        {/* Nuclei: optional tags */}
        {scanner === 'nuclei' && (
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>TEMPLATE TAGS <span style={{ opacity: 0.5 }}>(optional, comma-separated)</span></label>
            <input type="text" placeholder="cve,exposure,misconfig" value={tags} disabled={loading}
              onChange={(e) => setTags(e.target.value)} style={inputStyle} />
          </div>
        )}

        {/* ffuf: rate */}
        {scanner === 'ffuf' && (
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>RATE <span style={{ opacity: 0.5 }}>(requests/sec)</span></label>
            <input type="number" min={1} value={rate} disabled={loading}
              onChange={(e) => setRate(e.target.value)} style={inputStyle} />
          </div>
        )}

        {/* Status / error */}
        {statusText && !error && (
          <div style={{ marginTop: '8px', padding: '12px 14px', background: 'var(--accent-primary)0D', border: '1px solid var(--border-subtle)', borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {loading && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
            Status: <strong style={{ color: 'var(--text-primary)', textTransform: 'uppercase' }}>{statusText}</strong>
          </div>
        )}
        {error && (
          <div style={{ marginTop: '8px', padding: '12px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '8px', color: '#f87171', fontSize: '0.82rem', wordBreak: 'break-word' }}>
            ⚠️ {error}
          </div>
        )}

        {/* Run button */}
        <button onClick={handleRun} disabled={!targetUrl.trim() || loading} className="btn-premium"
          style={{ width: '100%', marginTop: '24px', padding: '14px', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', opacity: (!targetUrl.trim() || loading) ? 0.5 : 1 }}>
          {loading ? (<><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> SCANNING...</>) : (<>⚡ RUN DAST SCAN</>)}
        </button>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }` }} />
    </div>
  );
}
