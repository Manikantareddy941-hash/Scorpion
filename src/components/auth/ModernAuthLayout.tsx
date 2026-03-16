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
        <div style={{ position: 'relative', minHeight: '100vh', background: '#0D0D0D', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>

            {/* Scorpion SVG background */}
            <div style={{ position: 'fixed', inset: 0, zIndex: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', overflow: 'visible' }}>
              <svg viewBox="0 0 500 750" width="900" height="1000" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#f97316" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, overflow: 'visible' }}>
                <ellipse cx="250" cy="370" rx="38" ry="50" stroke="#f97316" strokeWidth="3"/>
                <ellipse cx="250" cy="318" rx="34" ry="28" stroke="#f97316" strokeWidth="3"/>
                <ellipse cx="250" cy="285" rx="30" ry="22" stroke="#f97316" strokeWidth="3"/>
                <ellipse cx="250" cy="255" rx="28" ry="20" stroke="#f97316" strokeWidth="3"/>
                <circle cx="241" cy="250" r="5" fill="#f97316"/>
                <circle cx="259" cy="250" r="5" fill="#f97316"/>
                <path d="M243 260 Q250 265 257 260" stroke="#f97316" strokeWidth="2"/>
                <path d="M233 248 Q215 228 195 205" stroke="#f97316" strokeWidth="3.5"/>
                <path d="M195 205 Q175 182 150 158" stroke="#f97316" strokeWidth="3.5"/>
                <path d="M150 158 Q130 138 105 118" stroke="#f97316" strokeWidth="3"/>
                <circle cx="105" cy="118" r="7" fill="#f97316"/>
                <path d="M105 118 Q82 95 68 75" stroke="#f97316" strokeWidth="3"/>
                <path d="M68 75 Q52 55 48 38" stroke="#f97316" strokeWidth="2.5"/>
                <path d="M105 118 Q88 108 78 95" stroke="#f97316" strokeWidth="3"/>
                <path d="M78 95 Q65 82 62 65" stroke="#f97316" strokeWidth="2.5"/>
                <path d="M267 248 Q285 228 305 205" stroke="#f97316" strokeWidth="3.5"/>
                <path d="M305 205 Q325 182 350 158" stroke="#f97316" strokeWidth="3.5"/>
                <path d="M350 158 Q370 138 395 118" stroke="#f97316" strokeWidth="3"/>
                <circle cx="395" cy="118" r="7" fill="#f97316"/>
                <path d="M395 118 Q418 95 432 75" stroke="#f97316" strokeWidth="3"/>
                <path d="M432 75 Q448 55 452 38" stroke="#f97316" strokeWidth="2.5"/>
                <path d="M395 118 Q412 108 422 95" stroke="#f97316" strokeWidth="3"/>
                <path d="M422 95 Q435 82 438 65" stroke="#f97316" strokeWidth="2.5"/>
                <path d="M226 345 Q200 338 175 330 Q155 325 132 318" stroke="#f97316" strokeWidth="2"/>
                <path d="M224 362 Q198 358 173 355 Q152 352 128 348" stroke="#f97316" strokeWidth="2"/>
                <path d="M223 378 Q197 378 172 380 Q151 382 127 385" stroke="#f97316" strokeWidth="2"/>
                <path d="M224 394 Q198 398 173 404 Q152 408 128 415" stroke="#f97316" strokeWidth="2"/>
                <path d="M274 345 Q300 338 325 330 Q345 325 368 318" stroke="#f97316" strokeWidth="2"/>
                <path d="M276 362 Q302 358 327 355 Q348 352 372 348" stroke="#f97316" strokeWidth="2"/>
                <path d="M277 378 Q303 378 328 380 Q349 382 373 385" stroke="#f97316" strokeWidth="2"/>
                <path d="M276 394 Q302 398 327 404 Q348 408 372 415" stroke="#f97316" strokeWidth="2"/>
                <path d="M250 420 Q258 445 268 465" stroke="#f97316" strokeWidth="4"/>
                <path d="M268 465 Q282 490 300 508" stroke="#f97316" strokeWidth="4"/>
                <path d="M300 508 Q322 528 342 540" stroke="#f97316" strokeWidth="3.5"/>
                <path d="M342 540 Q368 552 385 562" stroke="#f97316" strokeWidth="3.5"/>
                <path d="M385 562 Q408 568 418 555" stroke="#f97316" strokeWidth="3"/>
                <path d="M418 555 Q430 538 422 518" stroke="#f97316" strokeWidth="3"/>
                <path d="M422 518 Q415 498 405 488" stroke="#f97316" strokeWidth="2.5"/>
                <path d="M405 488 Q395 475 398 462" stroke="#f97316" strokeWidth="2.5"/>
                <ellipse cx="400" cy="456" rx="5" ry="9" fill="#f97316" transform="rotate(-20 400 456)"/>
                <circle cx="268" cy="465" r="5" fill="#f97316"/>
                <circle cx="300" cy="508" r="5" fill="#f97316"/>
                <circle cx="342" cy="540" r="5" fill="#f97316"/>
                <circle cx="385" cy="562" r="5" fill="#f97316"/>
                <circle cx="418" cy="555" r="4" fill="#f97316"/>
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