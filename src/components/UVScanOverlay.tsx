import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface Props {
  onComplete: () => void;
  scanTarget: string;
  scanId: string | null;
}

export default function UVScanOverlay({ onComplete, scanTarget, scanId }: Props) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('INITIALIZING SCAN...');
  const { getJWT } = useAuth();

  useEffect(() => {
    if (!scanId) {
      // If no scanId yet, just show initializing
      const initInterval = setInterval(() => {
        setProgress(p => Math.min(p + 2, 20));
      }, 500);
      return () => clearInterval(initInterval);
    }

    const pollStatus = async () => {
      try {
        const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
        const token = await getJWT();
        const res = await fetch(`${apiBase}/api/repos/scans/${scanId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (data.status === 'completed') {
          setProgress(100);
          setStatus('SCAN COMPLETE!');
          setTimeout(onComplete, 1000);
          return true;
        } else if (data.status === 'failed') {
          setStatus('SCAN FAILED');
          setTimeout(onComplete, 2000);
          return true;
        } else if (data.status === 'in_progress') {
          setStatus('SCANNING FOR VULNERABILITIES...');
          setProgress(p => Math.min(p + 10, 90));
        } else if (data.status === 'queued') {
          setStatus('QUEUED IN PIPELINE...');
          setProgress(p => Math.min(p + 5, 30));
        }
        return false;
      } catch (err) {
        console.error('Status poll failed:', err);
        return false;
      }
    };

    const interval = setInterval(async () => {
      const finished = await pollStatus();
      if (finished) clearInterval(interval);
    }, 3000);

    return () => clearInterval(interval);
  }, [scanId, getJWT, onComplete]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0D0D0D', zIndex: 2000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      {/* Sweeping beam animation */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{
          position: 'absolute', left: 0, right: 0, height: '2px',
          background: 'linear-gradient(90deg, transparent, #E8440A, transparent)',
          boxShadow: '0 0 20px 8px rgba(232,68,10,0.3)',
          animation: 'scan-beam 1.5s linear infinite',
        }} />
      </div>

      {/* Logo */}
      <img src="/src/assets/final_logo_png.png" style={{ width: '80px', height: '80px', objectFit: 'contain', marginBottom: '32px', filter: 'drop-shadow(0 0 20px #E8440A)' }} />

      {/* Status */}
      <div style={{ color: '#E8440A', fontWeight: 800, fontSize: '1rem', letterSpacing: '0.2em', marginBottom: '8px' }}>
        {status}<span style={{ animation: 'blink 1s infinite' }}>_</span>
      </div>
      <div style={{ color: '#444', fontSize: '0.75rem', letterSpacing: '0.1em', marginBottom: '32px' }}>
        TARGET: {scanTarget}
      </div>

      {/* Progress bar */}
      <div style={{ width: '400px', maxWidth: '80vw', height: '4px', background: '#1E1E1E', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ height: '100%', background: '#E8440A', width: `${progress}%`, transition: 'width 0.5s ease', boxShadow: '0 0 10px #E8440A' }} />
      </div>
      <div style={{ color: '#666', fontSize: '0.75rem', marginTop: '12px' }}>{Math.round(progress)}%</div>
    </div>
  );
}
