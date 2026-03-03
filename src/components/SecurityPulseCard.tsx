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
        <div className="bg-white dark:bg-slate-900 rounded-[2rem] p-8 shadow-2xl shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-800 relative overflow-hidden group">
            {/* Header */}
            <div className="flex items-center justify-between mb-12">
                <div className="flex items-center gap-4">
                    <div className="bg-blue-50 dark:bg-blue-900/30 p-3 rounded-2xl">
                        <Shield className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>
                    <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tighter italic">
                        Security Intelligence Pulse
                    </h2>
                </div>
                <div className="flex items-center gap-1 px-4 py-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-full text-xs font-black italic tracking-tight">
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
                            className="text-slate-100 dark:text-slate-800"
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
                            className="text-blue-600 dark:text-blue-500 transition-all duration-1000 ease-out"
                            strokeLinecap="round"
                        />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                        <span className="text-7xl font-black text-slate-900 dark:text-white tracking-tighter italic leading-none">
                            {healthScore}
                        </span>
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2 italic shadow-sm">
                            Health Score
                        </span>
                    </div>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-2 gap-6">
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-3xl border border-slate-100 dark:border-slate-700/50 hover:border-red-200 dark:hover:border-red-900/50 transition-all group/card">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 italic">Critical Risks</p>
                        <p className="text-4xl font-black text-red-500 tracking-tighter italic leading-none group-hover/card:scale-110 transition-transform origin-left">
                            {criticalRisks.toString().padStart(2, '0')}
                        </p>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-3xl border border-slate-100 dark:border-slate-700/50 hover:border-emerald-200 dark:hover:border-emerald-900/50 transition-all group/card">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 italic">Patch Rate</p>
                        <p className="text-4xl font-black text-emerald-500 tracking-tighter italic leading-none group-hover/card:scale-110 transition-transform origin-left">
                            {patchRate}%
                        </p>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-3xl border border-slate-100 dark:border-slate-700/50 hover:border-blue-200 dark:hover:border-blue-900/50 transition-all group/card">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 italic">Avg Fix Time</p>
                        <p className="text-4xl font-black text-blue-600 dark:text-blue-400 tracking-tighter italic leading-none group-hover/card:scale-110 transition-transform origin-left">
                            {avgFixTime}h
                        </p>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-3xl border border-slate-100 dark:border-slate-700/50 hover:border-slate-200 dark:hover:border-slate-600 transition-all group/card">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 italic">Managed Repos</p>
                        <p className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter italic leading-none group-hover/card:scale-110 transition-transform origin-left">
                            {managedRepos}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
