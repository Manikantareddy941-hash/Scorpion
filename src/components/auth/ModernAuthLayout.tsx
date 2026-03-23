import { ReactNode } from "react"

interface ModernAuthLayoutProps {
    children: ReactNode
    subtext?: string
}

import { useTheme } from '../../contexts/ThemeContext';
import logoImg from '../../assets/pre-final_logo-removebg-preview.png';

export default function ModernAuthLayout({
    children,
    subtext = "Clarity. Security. Productivity.",
}: ModernAuthLayoutProps) {
    const { getLogoFilter } = useTheme();
    return (
        <div style={{ position: 'relative', minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', transition: 'background 0.3s' }}>

            {/* Login card */}
            <div style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: '420px', padding: '0 16px' }}>
                <div className="p-8 backdrop-blur-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.1)] transition-colors duration-300">
                    <div className="flex flex-col items-center mb-8">
                        <div className="w-16 h-16 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl flex items-center justify-center mb-6 shadow-inner overflow-hidden p-2 transition-colors duration-300">
                         <img src={logoImg} alt="Scorpion Logo" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: getLogoFilter(), mixBlendMode: 'screen' }} />
                        </div>
                        <h1 className="text-2xl font-black tracking-tighter italic text-[var(--text-primary)]">
                            SCORPION <span className="text-[var(--accent-primary)]">SYSTEM</span>
                        </h1>
                        <div className="w-12 h-1 bg-[var(--accent-primary)]/30 rounded-full mt-2" />
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[var(--text-secondary)] mt-4">
                            {subtext}
                        </p>
                    </div>

                    {children}

                </div>
            </div>
        </div>
    )
}
