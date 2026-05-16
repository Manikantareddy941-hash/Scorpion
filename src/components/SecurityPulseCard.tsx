import React from 'react';
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
        <div className="bg-[var(--bg-card)] rounded-2xl p-5 shadow-sm border border-[var(--border-subtle)] relative overflow-hidden group">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="bg-[var(--accent-primary)]/10 p-2 rounded-xl border border-[var(--accent-primary)]/20">
                        <Shield className="w-5 h-5 text-[var(--accent-primary)]" />
                    </div>
                    <h2 className="text-md font-black text-[var(--text-primary)] uppercase tracking-tighter italic">
                        Security Intelligence Pulse
                    </h2>
                </div>
                <div className="flex items-center gap-1 px-3 py-1 bg-[var(--status-success)]/10 text-[var(--status-success)] rounded-full text-[10px] font-black italic tracking-tight border border-[var(--status-success)]/20">
                    <ArrowUpRight className="w-3 h-3" />
                    {trend}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                {/* Gauge Section */}
                <div className="relative flex items-center justify-center">
                    <svg className="w-40 h-40 transform -rotate-90">
                        {/* Background Circle */}
                        <circle
                            cx="80"
                            cy="80"
                            r="60"
                            stroke="currentColor"
                            strokeWidth="16"
                            fill="transparent"
                            className="text-[var(--border-subtle)]"
                        />
                        {/* Progress Circle */}
                        <circle
                            cx="80"
                            cy="80"
                            r="60"
                            stroke="currentColor"
                            strokeWidth="16"
                            fill="transparent"
                            strokeDasharray={2 * Math.PI * 60}
                            style={{ strokeDashoffset: (2 * Math.PI * 60) - (healthScore / 100) * (2 * Math.PI * 60) }}
                            className="text-[var(--accent-primary)] transition-all duration-1000 ease-out drop-shadow-[0_0_8px_var(--accent-primary)]/40"
                            strokeLinecap="round"
                        />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                        <span className="text-5xl font-black text-[var(--text-primary)] tracking-tighter italic leading-none">
                            {healthScore}
                        </span>
                        <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest mt-2 italic shadow-sm">
                            Health Score
                        </span>
                    </div>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-[var(--bg-primary)] p-4 rounded-2xl border border-[var(--border-subtle)] hover:border-[var(--status-error)]/30 transition-all group/card">
                        <p className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest mb-2 italic">Critical Risks</p>
                        <p className="text-2xl font-black text-[var(--status-error)] tracking-tighter italic leading-none group-hover/card:scale-110 transition-transform origin-left">
                            {criticalRisks.toString().padStart(2, '0')}
                        </p>
                    </div>

                    <div className="bg-[var(--bg-primary)] p-4 rounded-2xl border border-[var(--border-subtle)] hover:border-[var(--status-success)]/30 transition-all group/card">
                        <p className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest mb-2 italic">Patch Rate</p>
                        <p className="text-2xl font-black text-[var(--status-success)] tracking-tighter italic leading-none group-hover/card:scale-110 transition-transform origin-left">
                            {patchRate}%
                        </p>
                    </div>

                    <div className="bg-[var(--bg-primary)] p-4 rounded-2xl border border-[var(--border-subtle)] hover:border-[var(--status-warning)]/30 transition-all group/card">
                        <p className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest mb-2 italic">Avg Fix Time</p>
                        <p className="text-2xl font-black text-[var(--status-warning)] tracking-tighter italic leading-none group-hover/card:scale-110 transition-transform origin-left">
                            {avgFixTime}h
                        </p>
                    </div>

                    <div className="bg-[var(--bg-primary)] p-4 rounded-2xl border border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/30 transition-all group/card">
                        <p className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest mb-2 italic">Managed Repos</p>
                        <p className="text-2xl font-black text-[var(--text-primary)] tracking-tighter italic leading-none group-hover/card:scale-110 transition-transform origin-left">
                            {managedRepos}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
