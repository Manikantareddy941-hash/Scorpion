import { Link } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import logoImg from '../assets/scorpionlegs-removebg-preview.png';

export default function Footer() {
  const { getLogoFilter, getLogoBlendMode } = useTheme();
  
  return (
    <footer className="w-full bg-transparent pt-32 pb-10 overflow-hidden">
      <div className="w-full px-8 lg:px-16">
        
        {/* Top Section */}
        <div className="flex flex-col lg:flex-row justify-between items-start gap-12 lg:gap-20 mb-32">
          <div className="max-w-md">
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-[var(--text-primary)] leading-[0.9] uppercase italic">
              PROTECT THE STACK.<br />EXPERIENCE LIFTOFF.
            </h2>
          </div>
          
          <div className="grid grid-cols-2 gap-12 md:gap-24">
            <div>
              <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-6 italic opacity-40">Interface</h4>
              <ul className="space-y-4">
                <li><Link to="/" className="text-xs font-bold text-[var(--text-primary)] hover:text-[var(--accent-primary)] transition-colors uppercase italic tracking-tight">Dashboard</Link></li>
                <li><Link to="/security" className="text-xs font-bold text-[var(--text-primary)] hover:text-[var(--accent-primary)] transition-colors uppercase italic tracking-tight">Security</Link></li>
                <li><Link to="/reports" className="text-xs font-bold text-[var(--text-primary)] hover:text-[var(--accent-primary)] transition-colors uppercase italic tracking-tight">Reports</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-6 italic opacity-40">Network</h4>
              <ul className="space-y-4">
                <li><Link to="/teams" className="text-xs font-bold text-[var(--text-primary)] hover:text-[var(--accent-primary)] transition-colors uppercase italic tracking-tight">Teams</Link></li>
                <li><Link to="/alerts" className="text-xs font-bold text-[var(--text-primary)] hover:text-[var(--accent-primary)] transition-colors uppercase italic tracking-tight">Alerts</Link></li>
              </ul>
            </div>
          </div>
        </div>

        {/* SCORPION watermark — fits exactly within padding */}
        <div className="mb-20 flex items-center justify-center overflow-hidden">
          <h1
            className="font-black leading-none select-none uppercase italic"
            style={{
              fontSize: 'clamp(80px, 15vw, 200px)',
              letterSpacing: '-0.03em',
              color: 'var(--text-primary)',
              opacity: 0.08,
              textAlign: 'center',
            }}
          >
            SCORPION
          </h1>
        </div>

        {/* Bottom Bar */}
        <div className="flex flex-row justify-between items-center pt-6 border-t border-[var(--border-subtle)] w-full">
          <div className="flex items-center gap-3">
            <img 
              src={logoImg} 
              alt="Scorpion Logo" 
              className="w-5 h-5 object-contain"
              style={{ filter: getLogoFilter(), mixBlendMode: getLogoBlendMode() }} 
            />
            <span className="text-[10px] font-black tracking-[0.2em] text-[var(--text-primary)] uppercase italic">SCORPION CORE</span>
          </div>
          
          <div className="flex items-center gap-x-8">
            <Link to="#" className="text-[9px] font-black text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors uppercase tracking-[0.2em] italic">ABOUT</Link>
            <Link to="#" className="text-[9px] font-black text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors uppercase tracking-[0.2em] italic">PRIVACY SUITE</Link>
            <Link to="#" className="text-[9px] font-black text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors uppercase tracking-[0.2em] italic">TERMS OF SERVICE</Link>
            <span className="text-[9px] font-black text-[var(--text-primary)] uppercase tracking-[0.2em] italic">V1.0</span>
          </div>
        </div>

      </div>
    </footer>
  );
}
