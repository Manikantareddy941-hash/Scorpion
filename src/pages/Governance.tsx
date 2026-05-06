import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
    Shield, Scale, FileText, AlertTriangle, CheckCircle, 
    Plus, Trash2, Edit3, Save, X, ToggleLeft, ToggleRight,
    Search, Filter, Layout, List, ChevronRight, Loader2,
    Lock, Globe, Zap, Settings
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';

interface Policy {
    $id: string;
    name: string;
    description: string;
    rule_type: string;
    threshold: number;
    scope: string;
    enabled: boolean;
}

export default function Governance() {
    const { t } = useTranslation();
    const { getJWT } = useAuth();
    const [policies, setPolicies] = useState<Policy[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        rule_type: 'block_release',
        threshold: 0,
        scope: 'all'
    });

    useEffect(() => {
        console.log('[Governance] Component mounted');
        fetchPolicies();
    }, []);

    const fetchPolicies = async () => {
        setLoading(true);
        setError(null);
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const res = await fetch(`${apiBase}/api/policies`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
            
            const data = await res.json();
            setPolicies(Array.isArray(data) ? data : []);
            console.log(`[Governance] Successfully fetched ${data?.length || 0} policies`);
        } catch (err: any) {
            console.error('[Governance] Fetch error:', err.message);
            setError(err.message);
            toast.error('Failed to fetch governance policies');
        } finally {
            setLoading(false);
        }
    };

    const handleSavePolicy = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const method = editingPolicy ? 'PATCH' : 'POST';
            const url = editingPolicy ? `${apiBase}/api/policies/${editingPolicy.$id}` : `${apiBase}/api/policies`;
            
            const res = await fetch(url, {
                method,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            if (res.ok) {
                toast.success(editingPolicy ? 'Policy updated' : 'Governance policy active');
                setShowAddModal(false);
                setEditingPolicy(null);
                setFormData({ name: '', description: '', rule_type: 'block_release', threshold: 0, scope: 'all' });
                fetchPolicies();
            }
        } catch (err) {
            toast.error('Failed to save policy');
        }
    };

    const handleTogglePolicy = async (policy: Policy) => {
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            await fetch(`${apiBase}/api/policies/${policy.$id}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ enabled: !policy.enabled })
            });
            setPolicies(prev => prev.map(p => p.$id === policy.$id ? { ...p, enabled: !p.enabled } : p));
            toast.success(`Policy ${!policy.enabled ? 'activated' : 'deactivated'}`);
        } catch (err) {
            toast.error('Failed to update policy');
        }
    };

    const handleDeletePolicy = async (id: string) => {
        if (!window.confirm('Are you sure you want to delete this policy?')) return;
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            await fetch(`${apiBase}/api/policies/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setPolicies(prev => prev.filter(p => p.$id !== id));
            toast.success('Policy removed from ledger');
        } catch (err) {
            toast.error('Failed to delete policy');
        }
    };

    try {
        return (
            <div className="min-h-screen bg-[var(--bg-primary)] py-12 px-4 sm:px-6 lg:px-8">
                <div className="max-w-7xl mx-auto">
                    {/* Header */}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12">
                        <div>
                            <h1 className="text-3xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter">Governance Engine</h1>
                            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-1 font-mono">Policy-as-Code & Security Guardrails</p>
                        </div>

                        <button 
                            onClick={() => {
                                setEditingPolicy(null);
                                setFormData({ name: '', description: '', rule_type: 'block_release', threshold: 0, scope: 'all' });
                                setShowAddModal(true);
                            }}
                            className="btn-premium flex items-center gap-2"
                        >
                            <Plus size={18} />
                            New Policy
                        </button>
                    </div>

                    {/* Info Card */}
                    <div className="premium-card p-6 mb-12 bg-[var(--accent-primary)]/5 border-[var(--accent-primary)]/20 flex items-start gap-4">
                        <div className="p-3 bg-[var(--accent-primary)]/10 rounded-xl">
                            <Scale className="text-[var(--accent-primary)]" size={24} />
                        </div>
                        <div>
                            <h3 className="text-sm font-black text-[var(--text-primary)] uppercase italic">Security Compliance Protocol</h3>
                            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic mt-1 leading-relaxed">
                                Define automated gatekeeper rules. Policies are evaluated during every release cycle and scan event to ensure repository integrity aligns with enterprise standards.
                            </p>
                        </div>
                    </div>

                    {/* Policy List */}
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-24">
                            <Loader2 className="w-12 h-12 text-[var(--accent-primary)] animate-spin mb-4" />
                            <p className="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] italic">Compiling Governance Matrix...</p>
                        </div>
                    ) : error ? (
                        <div className="premium-card p-24 text-center border-red-500/20">
                            <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-6 opacity-40" />
                            <h3 className="text-xl font-black text-[var(--text-primary)] uppercase italic">Governance Protocol Failure</h3>
                            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic mt-2">{error}</p>
                            <button onClick={fetchPolicies} className="mt-6 btn-premium">Reconnect Uplink</button>
                        </div>
                    ) : policies.length === 0 ? (
                        <div className="premium-card p-24 text-center border-dashed">
                            <Shield className="w-16 h-16 text-[var(--text-secondary)] mx-auto mb-6 opacity-20" />
                            <h3 className="text-xl font-black text-[var(--text-primary)] uppercase italic">No Policies Active</h3>
                            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic mt-2">Establish your first security guardrail to begin automated enforcement</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            {policies.map((policy) => (
                                <div key={policy.$id} className={`premium-card group transition-all p-8 ${!policy.enabled ? 'opacity-60' : ''}`}>
                                    <div className="flex justify-between items-start mb-6">
                                        <div className="flex items-center gap-4">
                                            <div className={`p-3 rounded-2xl border ${policy.enabled ? 'bg-[var(--accent-primary)]/10 border-[var(--accent-primary)]/40 text-[var(--accent-primary)]' : 'bg-[var(--bg-primary)] border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}>
                                                <Shield size={20} />
                                            </div>
                                            <div>
                                                <h3 className="text-lg font-black text-[var(--text-primary)] uppercase italic tracking-tight">{policy.name}</h3>
                                                <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase italic flex items-center gap-2">
                                                    <Zap size={10} className="text-orange-500" />
                                                    {policy.rule_type?.replace('_', ' ')}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <button 
                                                onClick={() => handleTogglePolicy(policy)}
                                                className={`p-2 rounded-xl transition-all ${policy.enabled ? 'text-[var(--status-success)] bg-[var(--status-success)]/10' : 'text-[var(--text-secondary)] bg-[var(--bg-primary)] border border-[var(--border-subtle)]'}`}
                                            >
                                                {policy.enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                                            </button>
                                            <button 
                                                onClick={() => {
                                                    setEditingPolicy(policy);
                                                    setFormData({
                                                        name: policy.name,
                                                        description: policy.description,
                                                        rule_type: policy.rule_type,
                                                        threshold: policy.threshold,
                                                        scope: policy.scope
                                                    });
                                                    setShowAddModal(true);
                                                }}
                                                className="p-2 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors"
                                            >
                                                <Edit3 size={16} />
                                            </button>
                                            <button 
                                                onClick={() => handleDeletePolicy(policy.$id)}
                                                className="p-2 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-[var(--text-secondary)] hover:text-red-500 transition-colors"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>

                                    <p className="text-xs font-bold text-[var(--text-secondary)] uppercase italic leading-relaxed mb-8 min-h-[40px]">
                                        {policy.description}
                                    </p>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="p-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl">
                                            <p className="text-[8px] font-black text-[var(--text-secondary)] uppercase italic mb-1">Threshold</p>
                                            <p className="text-sm font-black text-[var(--text-primary)] italic uppercase tracking-tighter">
                                                {policy.threshold} CRITICAL ISSUES
                                            </p>
                                        </div>
                                        <div className="p-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl">
                                            <p className="text-[8px] font-black text-[var(--text-secondary)] uppercase italic mb-1">Application Scope</p>
                                            <p className="text-sm font-black text-[var(--text-primary)] italic uppercase tracking-tighter">
                                                {policy.scope?.toUpperCase()} REPOS
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Add/Edit Modal */}
                    {showAddModal && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowAddModal(false)} />
                            <div className="premium-card max-w-2xl w-full p-10 relative z-10 animate-in zoom-in-95 duration-200">
                                <h2 className="text-xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter mb-2">
                                    {editingPolicy ? 'Update Guardrail' : 'Construct Governance Policy'}
                                </h2>
                                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mb-8">Define rule parameters & enforcement logic</p>
                                
                                <form onSubmit={handleSavePolicy} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="md:col-span-2">
                                        <label className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest block mb-2">Policy Identifier</label>
                                        <input 
                                            type="text" 
                                            required
                                            placeholder="e.g. ZERO-CRITICAL-RELEASE-GATE"
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            className="w-full px-6 py-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl font-black italic text-xs outline-none focus:border-[var(--accent-primary)] text-[var(--text-primary)] transition-all"
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest block mb-2">Rule Objective</label>
                                        <textarea 
                                            required
                                            rows={3}
                                            placeholder="Describe the security requirement this policy enforces..."
                                            value={formData.description}
                                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                            className="w-full px-6 py-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl font-black italic text-xs outline-none focus:border-[var(--accent-primary)] text-[var(--text-primary)] transition-all resize-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest block mb-2">Rule Vector</label>
                                        <select 
                                            value={formData.rule_type}
                                            onChange={(e) => setFormData({ ...formData, rule_type: e.target.value })}
                                            className="w-full px-6 py-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl font-black italic text-xs outline-none focus:border-[var(--accent-primary)] text-[var(--text-primary)] appearance-none"
                                        >
                                            <option value="block_release">Block Release</option>
                                            <option value="fail_build">Fail Build</option>
                                            <option value="alert_only">Alert Only</option>
                                            <option value="quarantine">Quarantine</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest block mb-2">Max Critical Issues</label>
                                        <input 
                                            type="number" 
                                            required
                                            min={0}
                                            value={formData.threshold}
                                            onChange={(e) => setFormData({ ...formData, threshold: parseInt(e.target.value) })}
                                            className="w-full px-6 py-4 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl font-black italic text-xs outline-none focus:border-[var(--accent-primary)] text-[var(--text-primary)] transition-all"
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest block mb-2">Deployment Scope</label>
                                        <div className="flex gap-4">
                                            {['all', 'production', 'staging'].map((s) => (
                                                <button 
                                                    key={s}
                                                    type="button"
                                                    onClick={() => setFormData({ ...formData, scope: s })}
                                                    className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase italic tracking-widest transition-all border
                                                        ${formData.scope === s ? 'bg-[var(--accent-primary)] border-[var(--accent-primary)] text-black' : 'bg-[var(--bg-primary)] border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}
                                                >
                                                    {s}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="md:col-span-2 flex gap-4 pt-6">
                                        <button 
                                            type="button"
                                            onClick={() => setShowAddModal(false)}
                                            className="flex-1 px-6 py-4 rounded-2xl text-[10px] font-black uppercase italic tracking-widest border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] transition-all"
                                        >
                                            Discard
                                        </button>
                                        <button 
                                            type="submit"
                                            className="flex-1 px-6 py-4 rounded-2xl text-[10px] font-black uppercase italic tracking-widest bg-[var(--accent-primary)] text-black shadow-lg shadow-[var(--accent-primary)]/20 hover:scale-[1.02] transition-all"
                                        >
                                            {editingPolicy ? 'Update Logic' : 'Activate Policy'}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    )}
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
