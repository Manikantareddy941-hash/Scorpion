import { useEffect, useState } from 'react';
import { databases, DB_ID, ID, Query, COLLECTIONS } from '../lib/appwrite';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { 
    Code, 
    Loader2, 
    Save, 
    ArrowLeft, 
    Plus, 
    Trash2, 
    AlertCircle, 
    CheckCircle2, 
    Shield, 
    Edit3,
    Activity,
    Settings,
    Layout
} from 'lucide-react';

interface Rule {
    metric: 'security_score' | 'critical_count' | 'high_count' | 'medium_count' | 'low_count';
    operator: 'less_than' | 'greater_than' | 'equals';
    threshold: number;
}

interface Policy {
    $id?: string;
    name: string;
    description: string;
    rules: Rule[];
    action: 'block' | 'warn' | 'notify';
    isActive: boolean;
}

const METRIC_OPTIONS = [
    { value: 'security_score', label: 'Security Score' },
    { value: 'critical_count', label: 'Critical Vulnerabilities' },
    { value: 'high_count', label: 'High Vulnerabilities' },
    { value: 'medium_count', label: 'Medium Vulnerabilities' },
    { value: 'low_count', label: 'Low Vulnerabilities' },
];

const OPERATOR_OPTIONS = [
    { value: 'less_than', label: 'Less Than' },
    { value: 'greater_than', label: 'Greater Than' },
    { value: 'equals', label: 'Equals' },
];

const ACTION_OPTIONS = [
    { value: 'block', label: 'Block Pipeline' },
    { value: 'warn', label: 'Warning Only' },
    { value: 'notify', label: 'Notify Team' },
];

const safeParseRules = (code: any): Rule[] => {
    try {
        const parsed = JSON.parse(code || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export default function Governance() {
    const navigate = useNavigate();
    const { user } = useAuth();
    
    // List state
    const [policies, setPolicies] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    
    // Form state
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [policyName, setPolicyName] = useState('');
    const [description, setDescription] = useState('');
    const [rules, setRules] = useState<Rule[]>([{ metric: 'critical_count', operator: 'greater_than', threshold: 0 }]);
    const [action, setAction] = useState<'block' | 'warn' | 'notify'>('warn');
    const [isActive, setIsActive] = useState(true);
    
    const [saving, setSaving] = useState(false);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        if (user) {
            fetchPolicies();
        }
    }, [user]);

    const fetchPolicies = async () => {
        setLoading(true);
        try {
            const res = await databases.listDocuments(DB_ID, COLLECTIONS.POLICIES, [
                Query.equal('userId', user?.$id || ''),
                Query.orderDesc('$createdAt')
            ]);
            setPolicies(res.documents);
        } catch (e) {
            console.error('Error fetching policies', e);
        } finally {
            setLoading(false);
        }
    };

    const handleAddRule = () => {
        setRules([...rules, { metric: 'critical_count', operator: 'greater_than', threshold: 0 }]);
    };

    const handleRemoveRule = (index: number) => {
        if (rules.length === 1) return;
        setRules(rules.filter((_, i) => i !== index));
    };

    const handleRuleChange = (index: number, field: keyof Rule, value: any) => {
        const newRules = [...rules];
        newRules[index] = { ...newRules[index], [field]: value };
        setRules(newRules);
    };

    const handleResetForm = () => {
        setPolicyName('');
        setDescription('');
        setRules([{ metric: 'critical_count', operator: 'greater_than', threshold: 0 }]);
        setAction('warn');
        setIsActive(true);
        setEditingId(null);
        setShowForm(false);
    };

    const handleEditPolicy = (policy: any) => {
        setPolicyName(policy.name);
        setDescription(policy.description || '');
        try {
            setRules(safeParseRules(policy.code));
        } catch (e) {
            setRules([{ metric: 'critical_count', operator: 'greater_than', threshold: 0 }]);
        }
        setAction(policy.action || 'warn');
        setIsActive(policy.isActive);
        setEditingId(policy.$id);
        setShowForm(true);
    };

    const handleDeletePolicy = async (id: string) => {
        if (!confirm('Are you sure you want to delete this policy?')) return;
        try {
            await databases.deleteDocument(DB_ID, COLLECTIONS.POLICIES, id);
            setPolicies(policies.filter(p => p.$id !== id));
            setSuccessMessage('Policy deleted successfully');
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (e) {
            setErrorMessage('Failed to delete policy');
            setTimeout(() => setErrorMessage(null), 3000);
        }
    };

    const handleSavePolicy = async () => {
        if (!user) return;
        if (!policyName.trim()) {
            setErrorMessage('Policy name is required');
            return;
        }

        setSaving(true);
        const payload = {
            userId: user.$id,
            name: policyName,
            description,
            code: JSON.stringify(rules),
            action,
            isActive
        };

        try {
            if (editingId) {
                await databases.updateDocument(DB_ID, COLLECTIONS.POLICIES, editingId, payload);
                setSuccessMessage('Policy updated successfully');
            } else {
                await databases.createDocument(DB_ID, COLLECTIONS.POLICIES, ID.unique(), payload);
                setSuccessMessage('Policy created successfully');
            }
            handleResetForm();
            fetchPolicies();
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (error) {
            console.error('Failed to save policy', error);
            setErrorMessage('Failed to save policy');
            setTimeout(() => setErrorMessage(null), 3000);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] p-8 text-[var(--text-primary)] transition-colors duration-300">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="flex justify-between items-end mb-12">
                    <div>
                        <button onClick={() => navigate('/')} className="mb-6 px-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-primary)]/50 transition-all flex items-center gap-2 group/btn w-fit">
                            <ArrowLeft className="w-3.5 h-3.5 group-hover/btn:-translate-x-1 transition-transform" />
                            Back to Dashboard
                        </button>
                        <h1 className="text-3xl font-black tracking-tighter italic uppercase leading-none">Security Governance</h1>
                        <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.2em] mt-1 italic font-mono">
                            Policy Enforcement & Guardrails
                        </p>
                    </div>
                    {!showForm && (
                        <button 
                            onClick={() => setShowForm(true)}
                            className="btn-premium flex items-center gap-2"
                        >
                            <Plus className="w-4 h-4" />
                            Create New Policy
                        </button>
                    )}
                </div>

                {/* Form Section */}
                {showForm && (
                    <div className="premium-card p-10 mb-12 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Shield className="w-24 h-24 rotate-12" />
                        </div>
                        
                        <div className="flex items-center gap-3 mb-8">
                            <div className="p-2 bg-[var(--accent-primary)]/10 rounded-lg">
                                <Settings className="w-5 h-5 text-[var(--accent-primary)]" />
                            </div>
                            <h3 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-[0.2em] italic">
                                {editingId ? 'Edit Security Policy' : 'Build New Security Policy'}
                            </h3>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] ml-1">Policy Name</label>
                                <input 
                                    type="text" 
                                    value={policyName} 
                                    onChange={(e) => setPolicyName(e.target.value)} 
                                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl px-4 py-3 text-xs font-bold text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]/50 transition-colors"
                                    placeholder="e.g. Critical Production Guardrails"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] ml-1">Status</label>
                                <div className="flex items-center gap-4 h-[46px]">
                                    <button 
                                        onClick={() => setIsActive(!isActive)}
                                        className={`flex-1 h-full rounded-xl border transition-all flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest ${
                                            isActive 
                                            ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' 
                                            : 'bg-[var(--bg-secondary)] border-[var(--border-subtle)] text-[var(--text-secondary)]'
                                        }`}
                                    >
                                        <Activity className="w-3.5 h-3.5" />
                                        {isActive ? 'Active' : 'Disabled'}
                                    </button>
                                    <select 
                                        value={action}
                                        onChange={(e) => setAction(e.target.value as any)}
                                        className="flex-1 h-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl px-4 text-[10px] font-black uppercase tracking-widest text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]/50 transition-colors cursor-pointer"
                                    >
                                        {ACTION_OPTIONS.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2 mb-8">
                            <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] ml-1">Description</label>
                            <textarea 
                                value={description} 
                                onChange={(e) => setDescription(e.target.value)} 
                                className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl px-4 py-3 text-xs font-bold text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]/50 transition-colors min-h-[80px]"
                                placeholder="Explain the purpose of this policy..."
                            />
                        </div>

                        {/* Rules Editor */}
                        <div className="mb-10">
                            <div className="flex justify-between items-center mb-6">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-[var(--text-primary)] italic flex items-center gap-2">
                                    <Layout className="w-3.5 h-3.5 text-[var(--accent-secondary)]" /> Rule Definitions
                                </h4>
                                <button 
                                    onClick={handleAddRule}
                                    className="text-[10px] font-black uppercase tracking-widest text-[var(--accent-primary)] hover:text-[var(--accent-secondary)] transition-colors flex items-center gap-1"
                                >
                                    <Plus className="w-3 h-3" /> Add Row
                                </button>
                            </div>

                            <div className="space-y-3">
                                {rules.map((rule, idx) => (
                                    <div key={idx} className="flex gap-3 items-center group/row">
                                        <div className="flex-1 grid grid-cols-3 gap-3">
                                            <select 
                                                value={rule.metric}
                                                onChange={(e) => handleRuleChange(idx, 'metric', e.target.value)}
                                                className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[10px] font-bold text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]/50 transition-colors"
                                            >
                                                {METRIC_OPTIONS.map(opt => (
                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                ))}
                                            </select>
                                            <select 
                                                value={rule.operator}
                                                onChange={(e) => handleRuleChange(idx, 'operator', e.target.value)}
                                                className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[10px] font-bold text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]/50 transition-colors"
                                            >
                                                {OPERATOR_OPTIONS.map(opt => (
                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                ))}
                                            </select>
                                            <input 
                                                type="number" 
                                                value={rule.threshold}
                                                onChange={(e) => handleRuleChange(idx, 'threshold', parseInt(e.target.value) || 0)}
                                                className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[10px] font-bold text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]/50 transition-colors"
                                                placeholder="0"
                                            />
                                        </div>
                                        <button 
                                            onClick={() => handleRemoveRule(idx)}
                                            className="p-2 text-red-500/50 hover:text-red-500 transition-colors"
                                            disabled={rules.length === 1}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex justify-end items-center gap-4 border-t border-[var(--border-subtle)] pt-8">
                            <button 
                                onClick={handleResetForm}
                                className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                            >
                                Cancel
                            </button>
                            <button onClick={handleSavePolicy} className="btn-premium flex items-center gap-3">
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                {editingId ? 'Update Policy' : 'Create Policy'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Messages */}
                <div className="mb-6">
                    {successMessage && (
                        <div className="px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
                            <CheckCircle2 className="w-4 h-4" /> {successMessage}
                        </div>
                    )}
                    {errorMessage && (
                        <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
                            <AlertCircle className="w-4 h-4" /> {errorMessage}
                        </div>
                    )}
                </div>

                {/* Policies List */}
                {!showForm && (
                    <div className="space-y-6">
                        <div className="flex items-center gap-3 mb-4">
                            <Code className="w-4 h-4 text-[var(--accent-secondary)]" />
                            <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-primary)] italic">Active Governance Policies ({policies.length})</h2>
                        </div>

                        {loading ? (
                            <div className="flex flex-col items-center justify-center py-20 bg-[var(--bg-secondary)]/30 rounded-3xl border border-dashed border-[var(--border-subtle)]">
                                <Loader2 className="w-8 h-8 text-[var(--accent-primary)] animate-spin mb-4" />
                                <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">Retrieving encrypted policies...</p>
                            </div>
                        ) : policies.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 bg-[var(--bg-secondary)]/30 rounded-3xl border border-dashed border-[var(--border-subtle)] text-center px-6">
                                <Shield className="w-12 h-12 text-[var(--border-subtle)] mb-4" />
                                <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] mb-2">No policies found</p>
                                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic leading-relaxed max-w-sm">
                                    Start by creating your first security guardrail to protect your infrastructure.
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {policies.map((policy) => (
                                    <div key={policy.$id} className="premium-card p-8 group relative hover:border-[var(--accent-primary)]/30 transition-all duration-500 cursor-pointer" onClick={() => handleEditPolicy(policy)}>
                                        <div className="flex justify-between items-start mb-6">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-2 h-2 rounded-full ${policy.isActive ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                                                <h3 className="text-sm font-black uppercase italic tracking-tight text-[var(--text-primary)]">{policy.name}</h3>
                                            </div>
                                            <div className="flex gap-2">
                                                <button 
                                                    onClick={() => handleEditPolicy(policy)}
                                                    className="p-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors"
                                                >
                                                    <Edit3 className="w-3.5 h-3.5" />
                                                </button>
                                                <button 
                                                    onClick={() => handleDeletePolicy(policy.$id)}
                                                    className="p-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-secondary)] hover:text-red-500 transition-colors"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>

                                        <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic leading-relaxed mb-6 line-clamp-2 min-h-[30px]">
                                            {policy.description || 'No description provided.'}
                                        </p>

                                        <div className="flex items-center justify-between pt-6 border-t border-[var(--border-subtle)]">
                                            <div className="flex items-center gap-2">
                                                <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest ${
                                                    policy.action === 'block' ? 'bg-red-500/10 text-red-400' :
                                                    policy.action === 'warn' ? 'bg-amber-500/10 text-amber-400' :
                                                    'bg-blue-500/10 text-blue-400'
                                                }`}>
                                                    {policy.action}
                                                </span>
                                                <span className="text-[8px] font-black uppercase tracking-widest text-[var(--text-secondary)]">
                                                    {safeParseRules(policy.code).length} Rules
                                                </span>
                                            </div>
                                            <span className="text-[8px] font-mono text-[var(--text-secondary)] opacity-50 uppercase">
                                                ID: {policy.$id.slice(0, 8)}...
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
