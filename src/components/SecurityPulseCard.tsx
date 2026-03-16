import { Shield, ArrowUpRight } from 'lucide-react';

interface SecurityPulseProps {
    healthScore: number;
    criticalRisks: number;
    patchRate: number;
    avgFixTime: number;
    managedRepos: number;
    trend?: string;
}

export default function SecurityPulseCard({
    healthScore,
    criticalRisks,
    patchRate,
    avgFixTime,
    managedRepos,
    trend = "+12.5% OPTIMAL"
}: SecurityPulseProps) {
    // Calculate stroke-dasharray for the circular progress
    const radius = 80;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (healthScore / 100) * circumference;

    return (
        <div className="bg-[#141414] rounded-2xl p-8 shadow-sm border border-[#1E1E1E] relative overflow-hidden group">
            {/* Header */}
            <div className="flex items-center justify-between mb-12">
                <div className="flex items-center gap-4">
                    <div className="bg-[#E8440A]/10 p-3 rounded-2xl border border-[#E8440A]/20">
                        <Shield className="w-6 h-6 text-[#E8440A]" />
                    </div>
                    <h2 className="text-xl font-black text-white uppercase tracking-tighter italic">
                        Security Intelligence Pulse
                    </h2>
                </div>
                <div className="flex items-center gap-1 px-4 py-2 bg-emerald-500/10 text-emerald-500 rounded-full text-xs font-black italic tracking-tight border border-emerald-500/20">
                    <ArrowUpRight className="w-4 h-4" />
                    {trend}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                {/* Gauge Section */}
                <div className="relative flex items-center justify-center">
                    <svg className="w-64 h-64 transform -rotate-90">
                        {/* Background Circle */}
                        <circle
                            cx="128"
                            cy="128"
                            r={radius}
                            stroke="currentColor"
                            strokeWidth="24"
                            fill="transparent"
                            className="text-[#1E1E1E]"
                        />
                        {/* Progress Circle */}
                        <circle
                            cx="128"
                            cy="128"
                            r={radius}
                            stroke="currentColor"
                            strokeWidth="24"
                            fill="transparent"
                            strokeDasharray={circumference}
                            style={{ strokeDashoffset: offset }}
                            className="text-[#E8440A] transition-all duration-1000 ease-out drop-shadow-[0_0_8px_rgba(232,68,10,0.4)]"
                            strokeLinecap="round"
                        />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                        <span className="text-7xl font-black text-white tracking-tighter italic leading-none">
                            {healthScore}
                        </span>
                        <span className="text-[10px] font-black text-[#666666] uppercase tracking-widest mt-2 italic shadow-sm">
                            Health Score
                        </span>
                    </div>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-2 gap-6">
                    <div className="bg-[#0D0D0D] p-6 rounded-2xl border border-[#1E1E1E] hover:border-red-500/30 transition-all group/card">
                        <p className="text-[10px] font-black text-[#666666] uppercase tracking-widest mb-3 italic">Critical Risks</p>
                        <p className="text-4xl font-black text-red-500 tracking-tighter italic leading-none group-hover/card:scale-110 transition-transform origin-left">
                            {criticalRisks.toString().padStart(2, '0')}
                        </p>
                    </div>

                    <div className="bg-[#0D0D0D] p-6 rounded-2xl border border-[#1E1E1E] hover:border-emerald-500/30 transition-all group/card">
                        <p className="text-[10px] font-black text-[#666666] uppercase tracking-widest mb-3 italic">Patch Rate</p>
                        <p className="text-4xl font-black text-emerald-500 tracking-tighter italic leading-none group-hover/card:scale-110 transition-transform origin-left">
                            {patchRate}%
                        </p>
                    </div>

                    <div className="bg-[#0D0D0D] p-6 rounded-2xl border border-[#1E1E1E] hover:border-blue-500/30 transition-all group/card">
                        <p className="text-[10px] font-black text-[#666666] uppercase tracking-widest mb-3 italic">Avg Fix Time</p>
                        <p className="text-4xl font-black text-blue-500 tracking-tighter italic leading-none group-hover/card:scale-110 transition-transform origin-left">
                            {avgFixTime}h
                        </p>
                    </div>

                    <div className="bg-[#0D0D0D] p-6 rounded-2xl border border-[#1E1E1E] hover:border-[#E8440A]/30 transition-all group/card">
                        <p className="text-[10px] font-black text-[#666666] uppercase tracking-widest mb-3 italic">Managed Repos</p>
                        <p className="text-4xl font-black text-white tracking-tighter italic leading-none group-hover/card:scale-110 transition-transform origin-left">
                            {managedRepos}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
