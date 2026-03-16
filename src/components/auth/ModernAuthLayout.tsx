import { ReactNode } from "react"
import ScorpionIcon from "../ScorpionIcon"
import scorpionBg from "../../assets/scorpion-bg.png"

interface ModernAuthLayoutProps {
    children: ReactNode
    subtext?: string
}

export default function ModernAuthLayout({
    children,
    subtext = "Clarity. Security. Productivity.",
}: ModernAuthLayoutProps) {
    return (
        <div style={{ position: 'relative', minHeight: '100vh', background: '#0D0D0D', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>

            {/* Scorpion left side - claws facing card */}
            <img
                src={scorpionBg}
                alt=""
                style={{
                    position: 'fixed',
                    left: '-80px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '650px',
                    height: 'auto',
                    opacity: 0.35,
                    zIndex: 0,
                    pointerEvents: 'none',
                    filter: 'brightness(0.9) sepia(1) saturate(4) hue-rotate(5deg)',
                }}
            />

            {/* Scorpion right side - tail facing card */}
            <img
                src={scorpionBg}
                alt=""
                style={{
                    position: 'fixed',
                    right: '-150px',
                    top: '50%',
                    transform: 'translateY(-50%) scaleX(-1) rotate(15deg)',
                    width: '580px',
                    height: 'auto',
                    opacity: 0.25,
                    zIndex: 0,
                    pointerEvents: 'none',
                    filter: 'brightness(0.9) sepia(1) saturate(4) hue-rotate(5deg)',
                }}
            />

            {/* Login card */}
            <div style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: '420px', padding: '0 16px' }}>
                <div className="p-8 backdrop-blur-xl bg-[#141414]/90 border border-[#2a2a2a] rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)]">
                    <div className="flex flex-col items-center mb-8">
                        <div className="w-16 h-16 bg-black border border-[#2a2a2a] rounded-xl flex items-center justify-center mb-6 shadow-inner ring-1 ring-white/5">
                            <ScorpionIcon size={40} color="#f97316" />
                        </div>
                        <h1 className="text-2xl font-black tracking-tighter italic text-white">
                            SCORPION <span className="text-[#f97316]">SYSTEM</span>
                        </h1>
                        <div className="w-12 h-1 bg-[#f97316]/30 rounded-full mt-2" />
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#666666] mt-4">
                            {subtext}
                        </p>
                    </div>

                    {children}

                </div>
            </div>
        </div>
    )
}