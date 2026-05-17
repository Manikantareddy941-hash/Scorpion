import React, { useState } from 'react';
import { 
    Shield, Scale, ToggleLeft, ToggleRight,
    Plus
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import robotMascot from '../assets/tony-ai.png';

export interface GovernancePolicy {
  id: string;
  name: string;
  isEnabled: boolean;
  frameworks: string[];
  threshold: string;
  scope: string;
  ruleDetail: string;
}

const activeGuardrails: GovernancePolicy[] = [
  {
    id: "pol-1",
    name: "SAST ZERO-CRITICAL GATEKEEPER",
    isEnabled: true,
    frameworks: ["SOC 2", "ISO 27001"],
    threshold: "CRITICAL ISSUES > 0",
    scope: "ALL REPOSITORIES",
    ruleDetail: "Automatically BLOCKS the release cycle if any Static Analysis tool detects an unmitigated Critical risk."
  },
  {
    id: "pol-2",
    name: "PRODUCTION DEPENDENCY COMPLIANCE",
    isEnabled: true,
    frameworks: ["OWASP TOP 10"],
    threshold: "HIGH/CRITICAL CVSS",
    scope: "PRODUCTION REPOS",
    ruleDetail: "Enforces a mandatory build failure if Trivy detects unpatched CVEs with a score above 8.0."
  },
  {
    id: "pol-3",
    name: "RUNTIME MONITORING GUARDRAIL",
    isEnabled: false,
    frameworks: ["SOC 2 Trust Criteria"],
    threshold: "MISSING FALCO AGENT",
    scope: "K8S / GITOPS INFRASTRUCTURE",
    ruleDetail: "Flags warning reports during the operate phase if runtime threat detection is missing."
  }
];

export default function Governance() {
    const { t } = useTranslation();
    const [policies, setPolicies] = useState<GovernancePolicy[]>(activeGuardrails);

    const handleTogglePolicy = (policyId: string) => {
        setPolicies(prev => prev.map(p => p.id === policyId ? { ...p, isEnabled: !p.isEnabled } : p));
        toast.success('Policy enforcement updated');
    };

    try {
        return (
            <div className="min-h-screen bg-[var(--bg-primary)] py-12 px-4 sm:px-6 lg:px-8">
                <div className="max-w-7xl mx-auto">
                    {/* Header */}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12 relative z-10">
                        <div>
                            <div className="flex items-center gap-4">
                                <h1 className="text-3xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter">Governance Engine</h1>
                                <img src={robotMascot} alt="TONY AI" className="w-12 h-12 object-contain drop-shadow-xl -mt-2" />
                            </div>
                            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-1 font-mono">Policy-as-Code & Security Guardrails</p>
                        </div>

                        <div className="flex flex-col items-end relative">
                            <button 
                                onClick={() => { toast('New Policy creation coming soon!', { icon: '🚧' }); }}
                                className="btn-premium flex items-center gap-2 relative z-20"
                            >
                                <Plus size={18} />
                                New Policy
                            </button>
                        </div>
                    </div>

                    {/* Info Card */}
                    <div className="premium-card p-6 mb-12 bg-white/5 border-white/10 flex items-start gap-4">
                        <div className="p-3 bg-white/10 rounded-xl">
                            <Scale className="text-emerald-500" size={24} />
                        </div>
                        <div>
                            <h3 className="text-sm font-black text-[var(--text-primary)] uppercase italic">Security Compliance Protocol</h3>
                            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic mt-1 leading-relaxed">
                                Define automated gatekeeper rules. Policies are evaluated during every release cycle and scan event to ensure repository integrity aligns with enterprise standards.
                            </p>
                        </div>
                    </div>

                    {/* Policy List */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {policies.map((policy) => (
                            <div key={policy.id} className={`premium-card group transition-all p-8 flex flex-col bg-white/5 border border-white/10 hover:border-white/20 rounded-2xl ${!policy.isEnabled ? 'opacity-60' : ''}`}>
                                <div className="flex justify-between items-start mb-6">
                                    <div className="flex items-center gap-4">
                                        <div className={`p-3 rounded-2xl border transition-all ${policy.isEnabled ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' : 'bg-white/5 border-white/10 text-[var(--text-secondary)]'}`}>
                                            <Shield size={20} />
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-black text-[var(--text-primary)] uppercase italic tracking-tight">{policy.name}</h3>
                                            <div className="flex items-center gap-2 mt-2">
                                                {policy.frameworks.map(fw => (
                                                    <span key={fw} className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[9px] font-mono font-bold text-zinc-300 tracking-wider">
                                                        {fw}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button 
                                            onClick={() => handleTogglePolicy(policy.id)}
                                            className={`w-10 h-6 rounded-full transition-all duration-200 relative cursor-pointer border-none outline-none ${
                                                policy.isEnabled 
                                                    ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' 
                                                    : 'bg-zinc-300'
                                            }`}
                                        >
                                            <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${
                                                policy.isEnabled ? 'right-1' : 'left-1'
                                            }`} />
                                        </button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4 mb-6">
                                    <div className="p-4 bg-black/40 border border-white/5 rounded-xl">
                                        <p className="text-[9px] font-black text-white/40 uppercase tracking-widest mb-1">Enforcement Threshold</p>
                                        <p className="text-sm font-black text-white italic uppercase tracking-tighter">
                                            {policy.threshold}
                                        </p>
                                    </div>
                                    <div className="p-4 bg-black/40 border border-white/5 rounded-xl">
                                        <p className="text-[9px] font-black text-white/40 uppercase tracking-widest mb-1">Application Scope</p>
                                        <p className="text-sm font-black text-white italic uppercase tracking-tighter">
                                            {policy.scope}
                                        </p>
                                    </div>
                                </div>
                                
                                <div className="mt-auto pt-4 border-t border-white/5">
                                    <p className="text-xs text-zinc-400 font-mono leading-relaxed">
                                        {policy.ruleDetail}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    } catch (renderError: any) {
        console.error('[Governance] Render crash:', renderError);
        return (
            <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] text-red-500 font-black uppercase italic p-8 text-center">
                Critical Render Failure in Governance Module.<br/>Check Console for Trace.
            </div>
        );
    }
}

