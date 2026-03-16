import { useEffect, useState } from 'react';

interface Props {
  onComplete: () => void;
  scanTarget: string;
}

export default function UVScanOverlay({ onComplete, scanTarget }: Props) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('INITIALIZING SCAN...');

  const steps = [
    'INITIALIZING SCAN...',
    'CLONING REPOSITORY...',
    'ANALYZING CODE STRUCTURE...',
    'SCANNING FOR VULNERABILITIES...',
    'DETECTING CODE SMELLS...',
    'CHECKING DUPLICATES...',
    'RUNNING SECURITY AUDIT...',
    'GENERATING REPORT...',
  ];

  useEffect(() => {
    let step = 0;
    const interval = setInterval(() => {
      step++;
      setProgress(Math.min((step / steps.length) * 100, 100));
      setStatus(steps[Math.min(step, steps.length - 1)]);
      if (step >= steps.length) {
        clearInterval(interval);
        setTimeout(onComplete, 800);
      }
    }, 600);
    return () => clearInterval(interval);
  }, []);

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
      <img src="/src/assets/scorpio-logo.jpg" style={{ width: '80px', height: '80px', objectFit: 'contain', marginBottom: '32px', filter: 'drop-shadow(0 0 20px #E8440A)' }} />

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
