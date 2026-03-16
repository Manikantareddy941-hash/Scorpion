import { ReactNode } from "react"
import ScorpionIcon from "../ScorpionIcon"

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

            {/* Scorpion SVG background */}
            <div style={{ position: 'fixed', inset: 0, zIndex: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <svg viewBox="0 0 1200 600" width="1200" height="600" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.45 }}>

                {/* BODY segments - horizontal */}
                <ellipse cx="600" cy="300" rx="55" ry="32" fill="#f97316" opacity="0.8"/>
                <ellipse cx="520" cy="300" rx="42" ry="28" fill="#f97316" opacity="0.8"/>
                <ellipse cx="450" cy="300" rx="35" ry="25" fill="#f97316" opacity="0.8"/>
                <ellipse cx="390" cy="300" rx="30" ry="22" fill="#f97316" opacity="0.8"/>
                <ellipse cx="338" cy="300" rx="26" ry="20" fill="#f97316" opacity="0.8"/>

                {/* HEAD */}
                <ellipse cx="290" cy="300" rx="30" ry="26" fill="#f97316" opacity="0.9"/>
                <circle cx="278" cy="290" r="5" fill="white"/>
                <circle cx="298" cy="287" r="5" fill="white"/>
                <circle cx="279" cy="290" r="2.5" fill="#0D0D0D"/>
                <circle cx="299" cy="287" r="2.5" fill="#0D0D0D"/>

                {/* CLAW ARM 1 - upper left */}
                <path d="M268 282 C248 265 222 248 195 232 C175 220 155 210 132 198"
                  stroke="#f97316" strokeWidth="5" fill="none" strokeLinecap="round"/>
                <circle cx="132" cy="198" r="9" fill="#f97316"/>
                <path d="M132 198 C112 182 90 165 72 148 C58 135 46 120 38 105"
                  stroke="#f97316" strokeWidth="4" fill="none" strokeLinecap="round"/>
                <path d="M38 105 C30 92 28 78 35 68"
                  stroke="#f97316" strokeWidth="3" fill="none" strokeLinecap="round"/>
                <path d="M132 198 C118 215 102 228 84 238 C68 246 52 250 36 248"
                  stroke="#f97316" strokeWidth="4" fill="none" strokeLinecap="round"/>
                <path d="M36 248 C22 247 12 240 8 230"
                  stroke="#f97316" strokeWidth="3" fill="none" strokeLinecap="round"/>

                {/* CLAW ARM 2 - lower left */}
                <path d="M268 318 C248 335 222 352 195 368 C175 380 155 390 132 402"
                  stroke="#f97316" strokeWidth="5" fill="none" strokeLinecap="round"/>
                <circle cx="132" cy="402" r="9" fill="#f97316"/>
                <path d="M132 402 C112 388 90 372 72 358 C58 346 46 332 38 318"
                  stroke="#f97316" strokeWidth="4" fill="none" strokeLinecap="round"/>
                <path d="M38 318 C30 305 28 292 35 282"
                  stroke="#f97316" strokeWidth="3" fill="none" strokeLinecap="round"/>
                <path d="M132 402 C118 418 102 432 84 442 C68 450 52 454 36 452"
                  stroke="#f97316" strokeWidth="4" fill="none" strokeLinecap="round"/>
                <path d="M36 452 C22 450 12 442 8 432"
                  stroke="#f97316" strokeWidth="3" fill="none" strokeLinecap="round"/>

                {/* LEGS - 4 pairs */}
                <path d="M370 282 C362 258 350 235 335 215" stroke="#f97316" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                <path d="M370 318 C362 342 350 365 335 385" stroke="#f97316" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                <path d="M420 280 C415 255 408 230 398 208" stroke="#f97316" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                <path d="M420 320 C415 345 408 370 398 392" stroke="#f97316" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                <path d="M480 278 C480 252 480 226 478 202" stroke="#f97316" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                <path d="M480 322 C480 348 480 374 478 398" stroke="#f97316" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                <path d="M545 278 C550 252 555 226 558 202" stroke="#f97316" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                <path d="M545 322 C550 348 555 374 558 398" stroke="#f97316" strokeWidth="2.5" fill="none" strokeLinecap="round"/>

                {/* TAIL - right side curling up */}
                <path d="M655 300 C688 298 720 292 750 280"
                  stroke="#f97316" strokeWidth="7" fill="none" strokeLinecap="round"/>
                <circle cx="750" cy="280" r="7" fill="#f97316"/>
                <path d="M750 280 C782 268 812 252 838 230"
                  stroke="#f97316" strokeWidth="6" fill="none" strokeLinecap="round"/>
                <circle cx="838" cy="230" r="7" fill="#f97316"/>
                <path d="M838 230 C865 208 888 182 902 152"
                  stroke="#f97316" strokeWidth="5.5" fill="none" strokeLinecap="round"/>
                <circle cx="902" cy="152" r="6" fill="#f97316"/>
                <path d="M902 152 C918 122 925 90 918 58"
                  stroke="#f97316" strokeWidth="5" fill="none" strokeLinecap="round"/>
                <circle cx="918" cy="58" r="6" fill="#f97316"/>
                <path d="M918 58 C910 32 892 15 868 8"
                  stroke="#f97316" strokeWidth="4.5" fill="none" strokeLinecap="round"/>
                <circle cx="868" cy="8" r="5" fill="#f97316"/>
                <path d="M868 8 C848 2 830 5 818 18"
                  stroke="#f97316" strokeWidth="4" fill="none" strokeLinecap="round"/>
                <ellipse cx="812" cy="22" rx="6" ry="12" fill="#f97316" transform="rotate(-40 812 22)"/>

              </svg>
            </div>

            {/* Login card */}
            <div style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: '420px', padding: '0 16px' }}>
                <div className="p-8 backdrop-blur-xl bg-[#141414]/90 border border-[#2a2a2a] rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)]">
                    <div className="flex flex-col items-center mb-8">
                        <div className="w-16 h-16 bg-black border border-[#2a2a2a] rounded-xl flex items-center justify-center mb-6 shadow-inner ring-1 ring-white/5">
                            <ScorpionIcon className="w-10 h-10 text-[#f97316]" />
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