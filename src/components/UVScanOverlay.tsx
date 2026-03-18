import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import logoImg from '../assets/scorpionlegs-removebg-preview.png';

interface Props {
  onComplete: () => void;
  scanTarget: string;
  scanId: string | null;
}

export default function UVScanOverlay({ onComplete, scanTarget, scanId }: Props) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('INITIALIZING SCAN...');
  const { getJWT } = useAuth();
  const { getLogoFilter, getLogoBlendMode } = useTheme();

  useEffect(() => {
    if (!scanId) {
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
    <div className="fixed inset-0 bg-[var(--bg-primary)] z-[2000] flex flex-col items-center justify-center transition-colors duration-500">
      {/* Sweeping beam animation */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div 
          className="absolute left-0 right-0 h-0.5 opacity-50"
          style={{
            background: 'linear-gradient(90deg, transparent, var(--accent-primary), transparent)',
            boxShadow: '0 0 25px 12px var(--accent-primary)',
            animation: 'scan-beam 1.5s linear infinite',
          }} 
        />
      </div>

      {/* Logo Container */}
      <div className="relative mb-12">
        <img 
          src={logoImg} 
          alt="Scorpion Logo" 
          className="w-32 h-32 object-contain transition-all duration-700"
          style={{ 
            filter: `${getLogoFilter()} drop-shadow(0 0 30px var(--accent-primary))`,
            mixBlendMode: getLogoBlendMode()
          }} 
        />
        <div className="absolute -inset-8 bg-[var(--accent-primary)]/5 rounded-full blur-3xl animate-pulse" />
      </div>

      {/* Status Info */}
      <div className="text-center relative z-10">
        <div className="text-[var(--accent-primary)] font-black text-xs uppercase tracking-[0.4em] mb-3 italic flex items-center justify-center gap-2">
          {status}
          <span className="w-1.5 h-4 bg-[var(--accent-primary)] animate-pulse" />
        </div>
        <div className="text-[var(--text-secondary)] text-[10px] font-black uppercase tracking-[0.2em] mb-12 italic font-mono opacity-60">
          UPLINK TARGET: {scanTarget}
        </div>

        {/* Progress System */}
        <div className="relative items-center flex flex-col">
          <div className="w-72 h-1 bg-[var(--bg-secondary)] rounded-full overflow-hidden border border-[var(--border-subtle)] shadow-inner">
            <div 
              className="h-full bg-[var(--accent-primary)] transition-all duration-700 ease-out relative"
              style={{ 
                width: `${progress}%`,
                boxShadow: '0 0 15px var(--accent-primary)'
              }} 
            />
          </div>
          <div className="text-[var(--text-secondary)] font-mono text-[9px] mt-4 font-black tracking-widest opacity-80 uppercase">
            {Math.round(progress)}% Integrity Verified
          </div>
        </div>
      </div>

      {/* Background Decorative Grid */}
      <div 
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(var(--accent-primary) 0.5px, transparent 0.5px)`,
          backgroundSize: '24px 24px'
        }}
      />
    </div>
  );
}
