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

            {/* Scorpion hugging the card */}
            <div style={{ position: 'fixed', inset: 0, zIndex: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <svg viewBox="0 0 900 600" width="900" height="600" xmlns="http://www.w3.org/2000/svg" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.45 }}>

                {/* ===================== */}
                {/* BODY - horizontal, behind card */}
                {/* ===================== */}
                <ellipse cx="450" cy="300" rx="50" ry="28" stroke="#f97316" strokeWidth="3"/>
                <ellipse cx="380" cy="300" rx="38" ry="25" stroke="#f97316" strokeWidth="3"/>
                <ellipse cx="320" cy="300" rx="32" ry="22" stroke="#f97316" strokeWidth="3"/>
                <ellipse cx="268" cy="300" rx="26" ry="20" stroke="#f97316" strokeWidth="3"/>

                {/* HEAD - left side */}
                <ellipse cx="220" cy="300" rx="24" ry="22" stroke="#f97316" strokeWidth="3"/>
                {/* Eyes */}
                <circle cx="210" cy="293" r="4" fill="#f97316"/>
                <circle cx="225" cy="290" r="4" fill="#f97316"/>
                {/* Mouth */}
                <path d="M210 308 Q220 314 230 308" stroke="#f97316" strokeWidth="2"/>

                {/* ===================== */}
                {/* LEFT CLAW (front of scorpion - left side of card) */}
                {/* ===================== */}
                {/* Left arm upper */}
                <path d="M205 288 Q185 268 162 248" stroke="#f97316" strokeWidth="3.5"/>
                <path d="M162 248 Q142 228 118 210" stroke="#f97316" strokeWidth="3"/>
                {/* Knuckle */}
                <circle cx="118" cy="210" r="7" fill="#f97316"/>
                {/* Upper pincer */}
                <path d="M118 210 Q95 190 72 172" stroke="#f97316" strokeWidth="3"/>
                <path d="M72 172 Q52 155 38 140" stroke="#f97316" strokeWidth="2.5"/>
                {/* Lower pincer */}
                <path d="M118 210 Q100 225 82 232" stroke="#f97316" strokeWidth="3"/>
                <path d="M82 232 Q62 240 45 242" stroke="#f97316" strokeWidth="2.5"/>

                {/* Left arm lower */}
                <path d="M205 312 Q182 330 158 348" stroke="#f97316" strokeWidth="3.5"/>
                <path d="M158 348 Q135 365 110 378" stroke="#f97316" strokeWidth="3"/>
                {/* Knuckle */}
                <circle cx="110" cy="378" r="7" fill="#f97316"/>
                {/* Upper pincer */}
                <path d="M110 378 Q88 360 68 345" stroke="#f97316" strokeWidth="3"/>
                <path d="M68 345 Q48 330 35 318" stroke="#f97316" strokeWidth="2.5"/>
                {/* Lower pincer */}
                <path d="M110 378 Q90 395 72 405" stroke="#f97316" strokeWidth="3"/>
                <path d="M72 405 Q52 415 38 420" stroke="#f97316" strokeWidth="2.5"/>

                {/* ===================== */}
                {/* LEGS - 4 pairs */}
                {/* ===================== */}
                {/* Leg pair 1 */}
                <path d="M320 283 Q310 255 295 232" stroke="#f97316" strokeWidth="2"/>
                <path d="M320 317 Q310 345 295 368" stroke="#f97316" strokeWidth="2"/>
                {/* Leg pair 2 */}
                <path d="M365 280 Q358 250 345 225" stroke="#f97316" strokeWidth="2"/>
                <path d="M365 320 Q358 350 345 375" stroke="#f97316" strokeWidth="2"/>
                {/* Leg pair 3 */}
                <path d="M415 278 Q412 248 405 220" stroke="#f97316" strokeWidth="2"/>
                <path d="M415 322 Q412 352 405 380" stroke="#f97316" strokeWidth="2"/>
                {/* Leg pair 4 */}
                <path d="M462 278 Q465 248 468 220" stroke="#f97316" strokeWidth="2"/>
                <path d="M462 322 Q465 352 468 380" stroke="#f97316" strokeWidth="2"/>

                {/* ===================== */}
                {/* TAIL - right side, curling up with stinger */}
                {/* ===================== */}
                {/* Tail segment 1 */}
                <path d="M500 300 Q530 295 558 288" stroke="#f97316" strokeWidth="4"/>
                <circle cx="558" cy="288" r="5" fill="#f97316"/>
                {/* Tail segment 2 */}
                <path d="M558 288 Q590 280 618 268" stroke="#f97316" strokeWidth="4"/>
                <circle cx="618" cy="268" r="5" fill="#f97316"/>
                {/* Tail segment 3 */}
                <path d="M618 268 Q650 252 672 232" stroke="#f97316" strokeWidth="3.5"/>
                <circle cx="672" cy="232" r="5" fill="#f97316"/>
                {/* Tail segment 4 - curling up */}
                <path d="M672 232 Q698 208 712 178" stroke="#f97316" strokeWidth="3.5"/>
                <circle cx="712" cy="178" r="5" fill="#f97316"/>
                {/* Tail segment 5 - curling inward */}
                <path d="M712 178 Q728 148 720 118" stroke="#f97316" strokeWidth="3"/>
                <circle cx="720" cy="118" r="4" fill="#f97316"/>
                {/* Tail segment 6 - curling back */}
                <path d="M720 118 Q715 90 698 72" stroke="#f97316" strokeWidth="3"/>
                {/* Stinger */}
                <path d="M698 72 Q688 55 678 42" stroke="#f97316" strokeWidth="2.5"/>
                <path d="M678 42 Q668 28 672 15" stroke="#f97316" strokeWidth="2.5"/>
                <ellipse cx="674" cy="12" rx="5" ry="9" fill="#f97316" transform="rotate(-20 674 12)"/>

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