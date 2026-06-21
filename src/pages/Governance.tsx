import React, { useEffect, useState } from 'react';
import {
    Shield, Scale,
    Plus, Check, X
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { account } from '../lib/appwrite';

const FRAMEWORK_COLORS: Record<string, string> = {
    'SOC 2': '#4FC3F7',
    'ISO 27001': '#9575CD',
    'OWASP TOP 10': '#E57373',
    'SOC 2 Trust Criteria': '#4FC3F7',
};
const frameworkColor = (fw: string) => FRAMEWORK_COLORS[fw] ?? 'var(--accent-primary)';

export interface GovernancePolicy {
    id: string;
    name: string;
    isEnabled: boolean;
    frameworks: string[];
    threshold: string;
    scope: string;
    ruleDetail: string;
}

// Seed defaults - per-user enabled/disabled overrides are persisted to the
// Appwrite account's prefs (account.updatePrefs) under governance_guardrails,
// merged onto these defaults on load.
const DEFAULT_GUARDRAILS: GovernancePolicy[] = [
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
    const [policies, setPolicies] = useState<GovernancePolicy[]>(DEFAULT_GUARDRAILS);

    useEffect(() => {
        const loadOverrides = async () => {
            try {
                const user = await account.get();
                const stored = user.prefs?.governance_guardrails;
                if (stored) {
                    const overrides: Record<string, boolean> = JSON.parse(stored);
                    setPolicies(DEFAULT_GUARDRAILS.map(p => ({
                        ...p,
                        isEnabled: overrides[p.id] ?? p.isEnabled,
                    })));
                }
            } catch {
                // keep defaults if prefs can't be loaded
            }
        };
        loadOverrides();
    }, []);

    const handleTogglePolicy = async (policyId: string) => {
        const previous = policies;
        const next = policies.map(p => p.id === policyId ? { ...p, isEnabled: !p.isEnabled } : p);
        setPolicies(next);
        try {
            const user = await account.get();
            const overrides: Record<string, boolean> = {};
            next.forEach(p => { overrides[p.id] = p.isEnabled; });
            await account.updatePrefs({ ...user.prefs, governance_guardrails: JSON.stringify(overrides) });
            toast.success('Policy enforcement updated');
        } catch (err) {
            setPolicies(previous);
            toast.error('Failed to save policy change');
        }
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
                                <div className="w-12 h-12 rounded-2xl bg-[var(--accent-primary)]/10 border border-[var(--border-subtle)] flex items-center justify-center">
                                    <Shield className="text-[var(--accent-primary)]" size={22} />
                                </div>
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
                    <div className="premium-card p-6 mb-12 bg-[var(--bg-card)] border-[var(--border-subtle)] flex items-start gap-4">
                        <div className="p-3 bg-[var(--bg-card)] rounded-xl">
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
                            <div key={policy.id} className={`premium-card group transition-all p-8 flex flex-col bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--border-subtle)] rounded-2xl ${!policy.isEnabled ? 'opacity-60' : ''}`}>
                                <div className="flex justify-between items-start mb-6">
                                    <div className="flex items-center gap-4">
                                        <div className={`p-3 rounded-2xl border transition-all ${policy.isEnabled ? 'bg-[var(--accent-primary)]/10 border-[var(--border-subtle)] text-emerald-500' : 'bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}>
                                            <Shield size={20} />
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-black text-[var(--text-primary)] uppercase italic tracking-tight">{policy.name}</h3>
                                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                                                {policy.frameworks.map(fw => (
                                                    <span
                                                        key={fw}
                                                        className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold tracking-wider border"
                                                        style={{
                                                            color: frameworkColor(fw),
                                                            backgroundColor: `color-mix(in srgb, ${frameworkColor(fw)} 12%, transparent)`,
                                                            borderColor: `color-mix(in srgb, ${frameworkColor(fw)} 35%, transparent)`,
                                                        }}
                                                    >
                                                        {fw}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={`text-[9px] font-black uppercase tracking-widest ${policy.isEnabled ? 'text-[var(--accent-primary)]' : 'text-[var(--text-secondary)]'}`}>
                                            {policy.isEnabled ? 'ON' : 'OFF'}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => handleTogglePolicy(policy.id)}
                                            aria-label={policy.isEnabled ? 'Disable policy' : 'Enable policy'}
                                            aria-pressed={policy.isEnabled ? 'true' : 'false'}
                                            className={`w-12 h-6 rounded-full transition-all duration-200 relative cursor-pointer border outline-none ${policy.isEnabled
                                                    ? 'bg-[var(--accent-primary)] border-[var(--accent-primary)]'
                                                    : 'bg-[var(--border-subtle)] border-[var(--border-subtle)]'
                                                }`}
                                        >
                                            <div className={`w-4 h-4 rounded-full bg-white shadow-sm absolute top-1 flex items-center justify-center transition-all ${policy.isEnabled ? 'right-1' : 'left-1'
                                                }`}>
                                                {policy.isEnabled
                                                    ? <Check size={10} className="text-[var(--accent-primary)]" strokeWidth={3} />
                                                    : <X size={10} className="text-[var(--text-secondary)]" strokeWidth={3} />}
                                            </div>
                                        </button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4 mb-6">
                                    <div className="p-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl">
                                        <p className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest mb-1">Enforcement Threshold</p>
                                        {/* FIX: was text-white — invisible on light beige bg. Now uses text-primary */}
                                        <p className="text-sm font-black text-[var(--text-primary)] italic uppercase tracking-tighter">
                                            {policy.threshold}
                                        </p>
                                    </div>
                                    <div className="p-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl">
                                        <p className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest mb-1">Application Scope</p>
                                        {/* FIX: was text-white — invisible on light beige bg. Now uses text-primary */}
                                        <p className="text-sm font-black text-[var(--text-primary)] italic uppercase tracking-tighter">
                                            {policy.scope}
                                        </p>
                                    </div>
                                </div>

                                <div className="mt-auto pt-4 border-t border-[var(--border-subtle)]">
                                    <p className="text-xs text-[var(--text-secondary)] font-mono leading-relaxed">
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
            <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] text-[var(--text-secondary)] font-black uppercase italic p-8 text-center">
                Critical Render Failure in Governance Module.<br />Check Console for Trace.
            </div>
        );
    }
}