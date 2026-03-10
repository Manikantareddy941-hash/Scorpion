import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
    ArrowLeft, Github, List,
    Shield, Clock,
    Terminal, Play, RefreshCw, Users, Trash2, Zap
} from 'lucide-react';
import { FindingsTable } from '../components/FindingsTable';
import { ScanHistory } from '../components/ScanHistory';
import RemediationPanel from '../components/RemediationPanel';

interface Vulnerability {
    id: string;
    tool: string;
    severity: string;
    message: string;
    file_path: string;
    line_number?: number;
    status: 'open' | 'resolved' | 'false_positive';
    created_at: string;
}

interface Scan {
    id: string;
    repo_id: string;
    status: 'queued' | 'in_progress' | 'completed' | 'failed';
    details: any;
    created_at: string;
}

export default function ProjectDetail() {
    const { id } = useParams();
    const [repo, setRepo] = useState<any>(null);
    const [vulnerabilities, setVulnerabilities] = useState<Vulnerability[]>([]);
    const [scans, setScans] = useState<Scan[]>([]);
    const [loading, setLoading] = useState(true);
    const [converting, setConverting] = useState<string | null>(null);
    const [triggering, setTriggering] = useState(false);
    const [activeTab, setActiveTab] = useState<'findings' | 'governance' | 'access'>('findings');
    const [policy, setPolicy] = useState<any>(null);
    const [projectAccess, setProjectAccess] = useState<any[]>([]);
    const [remediationId, setRemediationId] = useState<string | null>(null);

    useEffect(() => {
        if (id) {
            fetchProjectData();
            const interval = setInterval(fetchProjectData, 10000); // Refresh every 10s for scan status
            return () => clearInterval(interval);
        }
    }, [id]);

    const fetchProjectData = async () => {
        try {
            const { data: repository } = await supabase
                .from('repositories')
                .select('*')
                .eq('id', id)
                .single();
            setRepo(repository);

            const { data: vulns } = await supabase
                .from('vulnerabilities')
                .select('*')
                .eq('repo_id', id)
                .order('created_at', { ascending: false });
            setVulnerabilities(vulns || []);

            const { data: scanResults } = await supabase
                .from('scan_results')
                .select('*')
                .eq('repo_id', id)
                .order('created_at', { ascending: false })
                .limit(5);
            setScans(scanResults || []);

            // Fetch Policy
            const sessionData = localStorage.getItem('supabase.auth.token');
            const session = sessionData ? JSON.parse(sessionData) : null;
            const token = session?.currentSession?.access_token;
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

            const policyRes = await fetch(`${apiBase}/api/repos/${id}/policy`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (policyRes.ok) setPolicy(await policyRes.json());

            // Fetch Access
            const accessRes = await fetch(`${apiBase}/api/repos/${id}/access`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (accessRes.ok) setProjectAccess(await accessRes.json());

        } catch (err) {
            console.error('Error fetching project data:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleRunScan = async () => {
        if (!id) return;
        setTriggering(true);
        try {
            const sessionData = localStorage.getItem('supabase.auth.token');
            const session = sessionData ? JSON.parse(sessionData) : null;
            const token = session?.currentSession?.access_token;
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

            const response = await fetch(`${apiBase}/api/repos/${id}/scan`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                const data = await response.json();
                alert(data.error || 'Failed to trigger scan');
            } else {
                fetchProjectData();
            }
        } catch (err) {
            console.error('Error triggering scan:', err);
        } finally {
            setTriggering(null as any);
            setTriggering(false);
        }
    };

    const handleConvertToIssue = async (vulnId: string) => {
        setConverting(vulnId);
        try {
            const sessionData = localStorage.getItem('supabase.auth.token');
            const session = sessionData ? JSON.parse(sessionData) : null;
            const token = session?.currentSession?.access_token;
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

            const response = await fetch(`${apiBase}/api/vulnerabilities/${vulnId}/convert`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                alert('Finding converted to Task successfully!');
                fetchProjectData();
            }
        } catch (err) {
            console.error('Error converting vulnerability:', err);
        } finally {
            setConverting(null);
        }
    };

    if (loading) return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-800/50 flex items-center justify-center p-8">
            <div className="text-center">
                <Terminal className="w-12 h-12 text-blue-600 animate-pulse mx-auto mb-4" />
                <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-widest animate-pulse">Decrypting Repository...</h2>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-800/50 p-8 text-slate-900 dark:text-white">
            <div className="max-w-6xl mx-auto">
                {/* Header Actions */}
                <div className="flex items-center justify-between mb-8">
                    <Link to="/security" className="flex items-center gap-2 text-xs font-black text-slate-400 hover:text-blue-600 transition uppercase tracking-widest italic">
                        <ArrowLeft className="w-4 h-4" />
                        Back to Fleet
                    </Link>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={handleRunScan}
                            disabled={triggering}
                            className="flex items-center gap-2 px-6 py-2.5 bg-slate-900 text-white rounded-xl hover:bg-black transition font-black text-[10px] uppercase tracking-widest shadow-xl disabled:bg-slate-200"
                        >
                            {triggering ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                            Run New Audit
                        </button>
                        <a href={repo?.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs font-black text-blue-600 hover:text-blue-700 transition uppercase tracking-widest italic border-b border-transparent hover:border-blue-600">
                            <Github className="w-4 h-4" />
                            Source Code
                        </a>
                    </div>
                </div>

                {/* Project Overview Card */}
                <div className="bg-white dark:bg-slate-900 rounded-[2rem] p-10 shadow-sm border border-slate-200 dark:border-slate-700 mb-8 relative overflow-hidden group">
                    <div className="flex flex-col md:flex-row md:items-center justify-between relative z-10 gap-8">
                        <div>
                            <div className="flex items-center gap-3 mb-2">
                                <div className="bg-blue-600 p-2 rounded-xl">
                                    <Shield className="w-5 h-5 text-white" />
                                </div>
                                <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter italic uppercase">{repo?.name}</h1>
                            </div>
                            <p className="text-slate-400 font-mono text-[10px] mb-6 tracking-tight uppercase">{repo?.url}</p>
                            <div className="flex flex-wrap gap-4">
                                <Badge label={`Risk Score: ${repo?.risk_score || 0}%`} severity={(repo?.risk_score || 0) > 60 ? 'high' : 'low'} />
                                <Badge label={`${vulnerabilities.length} Findings`} severity="info" />
                                <Badge label={`Status: Online`} severity="success" />
                            </div>
                        </div>
                        <div className="text-center md:text-right border-t md:border-t-0 md:border-l border-slate-100 dark:border-slate-800 pt-8 md:pt-0 md:pl-12">
                            <div className="text-6xl font-black text-slate-900 dark:text-white tracking-tighter italic mb-1 group-hover:scale-110 transition-transform duration-500">{100 - (repo?.risk_score || 0)}</div>
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Health Index</div>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-6 border-b border-slate-200 dark:border-slate-700 mb-8">
                    <button
                        onClick={() => setActiveTab('findings')}
                        className={`pb-4 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'findings' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400 hover:text-slate-600 dark:text-slate-300'}`}
                    >
                        Findings
                    </button>
                    <button
                        onClick={() => setActiveTab('governance')}
                        className={`pb-4 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'governance' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400 hover:text-slate-600 dark:text-slate-300'}`}
                    >
                        Governance
                    </button>
                    <button
                        onClick={() => setActiveTab('access')}
                        className={`pb-4 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'access' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400 hover:text-slate-600 dark:text-slate-300'}`}
                    >
                        Access Control
                    </button>
                </div>

                {activeTab === 'findings' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-500">
                        <div className="lg:col-span-2">
                            <div className="flex items-center justify-between mb-6">
                                <h2 className="text-sm font-black text-slate-400 uppercase tracking-tighter italic">SecOps Findings</h2>
                                <div className="flex gap-2">
                                    <button className="p-2 text-slate-400 hover:text-slate-900 dark:text-white transition"><Clock className="w-4 h-4" /></button>
                                    <button className="p-2 text-slate-400 hover:text-slate-900 dark:text-white transition"><List className="w-4 h-4" /></button>
                                </div>
                            </div>
                            <FindingsTable
                                findings={vulnerabilities}
                                onConvert={handleConvertToIssue}
                                onRemediate={(id) => setRemediationId(id)}
                                convertingId={converting}
                            />
                        </div>

                        <div className="lg:col-span-1">
                            <h2 className="text-sm font-black text-slate-400 uppercase tracking-tighter italic mb-6">Audit History</h2>
                            <ScanHistory scans={scans} />

                            <div className="mt-8 bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-[2rem] text-white">
                                <h3 className="text-xs font-black uppercase tracking-widest italic mb-2">Automated Policy</h3>
                                <p className="text-[10px] text-slate-400 font-bold uppercase leading-relaxed">
                                    Scheduled audits run every 6 hours. CI/CD integrations trigger audits on every PR merge via the configured webhook.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'governance' && (
                    <GovernanceView policy={policy} repoId={id!} onUpdate={fetchProjectData} />
                )}

                {activeTab === 'access' && (
                    <AccessView access={projectAccess} repoId={id!} onUpdate={fetchProjectData} />
                )}
            </div>

            {remediationId && (
                <RemediationPanel
                    vulnerabilityId={remediationId}
                    onClose={() => setRemediationId(null)}
                />
            )}
        </div>
    );
}

function GovernanceView({ policy, repoId, onUpdate }: { policy: any, repoId: string, onUpdate: () => void }) {
    const [updating, setUpdating] = useState(false);

    const updatePolicy = async (profile: string) => {
        setUpdating(true);
        try {
            const sessionData = localStorage.getItem('supabase.auth.token');
            const session = sessionData ? JSON.parse(sessionData) : null;
            const token = session?.currentSession?.access_token;
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

            const response = await fetch(`${apiBase}/api/repos/${repoId}/policy`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ policy_name: profile })
            });

            if (response.ok) {
                onUpdate();
            } else {
                const err = await response.json();
                alert(err.error || 'Failed to update policy');
            }
        } catch (err) {
            console.error('Error updating policy:', err);
        } finally {
            setUpdating(false);
        }
    };

    return (
        <div className={`animate-in slide-in-from-bottom-4 duration-500 ${updating ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="md:col-span-2 space-y-8">
                    <div className="bg-white dark:bg-slate-900 rounded-[2rem] p-8 border border-slate-200 dark:border-slate-700">
                        <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight italic mb-6">Security Profile</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {['Strict', 'Balanced', 'Relaxed'].map((p) => (
                                <button
                                    key={p}
                                    onClick={() => updatePolicy(p.toLowerCase())}
                                    className={`p-6 rounded-2xl border-2 transition-all text-left ${policy?.policy_name?.toLowerCase() === p.toLowerCase()
                                        ? 'border-blue-600 bg-blue-50'
                                        : 'border-slate-100 dark:border-slate-800 hover:border-slate-300'
                                        }`}
                                >
                                    <h4 className="font-black text-xs uppercase tracking-widest mb-2">{p}</h4>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase leading-tight">
                                        {p === 'Strict' && 'Zero tolerance for high risks.'}
                                        {p === 'Balanced' && 'Standard safety thresholds.'}
                                        {p === 'Relaxed' && 'Monitoring only.'}
                                    </p>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-[2rem] p-8 border border-slate-200 dark:border-slate-700">
                        <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight italic mb-6">Custom Thresholds</h3>
                        <div className="space-y-6">
                            <ThresholdSlider label="Max Critical" value={policy?.max_critical || 0} max={10} />
                            <ThresholdSlider label="Max High" value={policy?.max_high || 0} max={20} />
                            <ThresholdSlider label="Min Risk Score" value={policy?.min_risk_score || 80} max={100} min={10} />
                        </div>
                    </div>
                </div>

                <div className="md:col-span-1">
                    <div className="bg-slate-900 rounded-[2rem] p-8 text-white sticky top-24">
                        <Zap className="w-8 h-8 text-yellow-400 mb-4" />
                        <h3 className="text-lg font-black uppercase tracking-widest italic mb-4">Policy Impact</h3>
                        <p className="text-xs text-slate-400 font-bold uppercase leading-relaxed mb-6">
                            Current policy is set to <span className="text-blue-400">{policy?.policy_name || 'Standard'}</span>.
                            Failing this policy will block CI/CD pipelines and send critical alerts to the security team.
                        </p>
                        <ul className="space-y-3">
                            <li className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                                <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                                CI/CD Blocking: Enabled
                            </li>
                            <li className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                                <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                                Critical Alerts: Active
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}

function AccessView({ access, repoId, onUpdate }: { access: any[], repoId: string, onUpdate: () => void }) {
    const [granting, setGranting] = useState(false);
    const [teams, setTeams] = useState<any[]>([]);
    const [selectedTeamId, setSelectedTeamId] = useState('');

    useEffect(() => {
        fetchTeams();
    }, []);

    const fetchTeams = async () => {
        const { data } = await supabase.from('teams').select('id, name');
        setTeams(data || []);
    };

    const grantAccess = async () => {
        if (!selectedTeamId) return;
        setGranting(true);
        try {
            const sessionData = localStorage.getItem('supabase.auth.token');
            const session = sessionData ? JSON.parse(sessionData) : null;
            const token = session?.currentSession?.access_token;
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

            const response = await fetch(`${apiBase}/api/repos/${repoId}/access`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ team_id: selectedTeamId, action: 'grant' })
            });

            if (response.ok) {
                onUpdate();
                setSelectedTeamId('');
            }
        } catch (err) {
            console.error('Error granting access:', err);
        } finally {
            setGranting(false);
        }
    };

    const revokeAccess = async (teamId: string) => {
        try {
            const sessionData = localStorage.getItem('supabase.auth.token');
            const session = sessionData ? JSON.parse(sessionData) : null;
            const token = session?.currentSession?.access_token;
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

            const response = await fetch(`${apiBase}/api/repos/${repoId}/access`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ team_id: teamId, action: 'revoke' })
            });

            if (response.ok) {
                onUpdate();
            }
        } catch (err) {
            console.error('Error revoking access:', err);
        }
    };

    return (
        <div className="animate-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="p-8 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight italic">Team Access</h3>
                    <div className="flex gap-2 w-full sm:w-auto">
                        <select
                            value={selectedTeamId}
                            onChange={(e) => setSelectedTeamId(e.target.value)}
                            className="flex-1 sm:w-48 px-4 py-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest outline-none focus:border-blue-500"
                        >
                            <option value="">Select Team</option>
                            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                        <button
                            onClick={grantAccess}
                            disabled={granting || !selectedTeamId}
                            className="px-5 py-2 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest disabled:opacity-50"
                        >
                            Grant
                        </button>
                    </div>
                </div>
                <div className="divide-y divide-slate-100">
                    {access.length === 0 ? (
                        <div className="p-12 text-center">
                            <Users className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                            <p className="text-slate-400 font-black uppercase tracking-widest italic">No teams have access yet</p>
                        </div>
                    ) : (
                        access.map((a) => (
                            <div key={a.id} className="p-6 flex items-center justify-between hover:bg-slate-50 dark:bg-slate-800/50 transition">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-slate-400 font-black italic">
                                        {a.teams?.name?.[0].toUpperCase()}
                                    </div>
                                    <div>
                                        <p className="font-black text-slate-900 dark:text-white uppercase tracking-tighter">{a.teams?.name}</p>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase italic">Team ID: {a.team_id.substring(0, 8)}...</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => revokeAccess(a.team_id)}
                                    className="p-2 text-slate-300 hover:text-red-500 transition"
                                >
                                    <Trash2 className="w-5 h-5" />
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

function ThresholdSlider({ label, value, max, min = 0 }: { label: string, value: number, max: number, min?: number }) {
    return (
        <div>
            <div className="flex justify-between mb-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</label>
                <span className="text-xs font-black text-blue-600">{value}</span>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                value={value}
                readOnly
                className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
        </div>
    );
}

function Badge({ label, severity }: { label: string, severity: string }) {
    const styles = {
        high: 'bg-red-50 text-red-600 border-red-100 shadow-sm shadow-red-50',
        low: 'bg-emerald-50 text-emerald-600 border-emerald-100',
        success: 'bg-emerald-50 text-emerald-600 border-emerald-100',
        info: 'bg-blue-50 text-blue-600 border-blue-100'
    }[severity] || 'bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 border-slate-100 dark:border-slate-800';

    return (
        <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest italic border ${styles}`}>
            {label}
        </span>
    );
}



