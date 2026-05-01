import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import {
    Github, Shield, ArrowLeft, Terminal, RefreshCw, Play, Trash2, X
} from 'lucide-react';
import toast from 'react-hot-toast';
import FindingsTable from '../components/FindingsTable';
import { ScanHistory } from '../components/ScanHistory';
import RemediationPanel from '../components/RemediationPanel';

interface Vulnerability {
    $id: string;
    tool: string;
    severity: string;
    message: string;
    file_path: string;
    line_number?: number;
    status: 'open' | 'resolved' | 'false_positive';
    $createdAt: string;
}

interface Scan {
    $id: string;
    repo_id: string;
    status: 'queued' | 'in_progress' | 'completed' | 'failed';
    details: any;
    $createdAt: string;
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
            fetchData();
            const interval = setInterval(fetchData, 10000); // Refresh every 10s for scan status
            return () => clearInterval(interval);
        }
    }, [id]);

    const fetchData = async () => {
        if (!id) return;
        try {
            // Fetch repo details
            const repoData = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, id);
            setRepo(repoData);

            // Fetch scans
            const scansData = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
                Query.equal('repo_id', id),
                Query.orderDesc('$createdAt'),
                Query.limit(20)
            ]);
            setScans(scansData.documents as any[]);

            // Fetch vulnerabilities
            const vulnerabilitiesData = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
                Query.equal('repo_id', id),
                Query.orderDesc('$createdAt'),
                Query.limit(100)
            ]);
            setVulnerabilities(vulnerabilitiesData.documents as any[]);

            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const token = localStorage.getItem('appwrite_jwt');
            // Fetch Policy
            const policyRes = await fetch(`${apiBase}/api/repos/${id}/policy`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (policyRes.ok) setPolicy(await policyRes.json());

            // Fetch Access
            const accessRes = await fetch(`${apiBase}/api/repos/${id}/access`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (accessRes.ok) setProjectAccess(await accessRes.json());

        } catch (err: any) {
            console.error('Error fetching project data:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleRunScan = async () => {
        if (!id) return;
        setTriggering(true);
        const toastId = toast.loading('Initiating scan perimeter...');
        try {
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const token = localStorage.getItem('appwrite_jwt');
            const response = await fetch(`${apiBase}/api/repos/${id}/scan`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            const data = await response.json();
            console.log('[DEBUG] Raw Scan API Response Tracker:', data);
            
            if (!response.ok) {
                toast.error((t) => (
                    <div className="flex items-center justify-between w-full gap-4">
                        <span>Scan failed: {data.error || 'Unknown error'}</span>
                        <button onClick={() => toast.dismiss(t.id)} className="p-1 hover:bg-black/10 rounded-full transition-colors"><X size={14} /></button>
                    </div>
                ), { id: toastId, duration: Infinity });
            } else {
                toast.success('Scan completed successfully', { id: toastId });
                fetchData();
            }
        } catch (err: any) {
            toast.error((t) => (
                <div className="flex items-center justify-between w-full gap-4">
                    <span>Scan failed: {err.message || 'Unknown error'}</span>
                    <button onClick={() => toast.dismiss(t.id)} className="p-1 hover:bg-black/10 rounded-full transition-colors"><X size={14} /></button>
                </div>
            ), { id: toastId, duration: Infinity });
        } finally {
            setTriggering(false);
        }
    };

    const handleConvertToIssue = async (vulnId: string) => {
        setConverting(vulnId);
        const toastId = toast.loading('Configuring tracker remediation...');
        try {
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const token = localStorage.getItem('appwrite_jwt');
            const response = await fetch(`${apiBase}/api/vulnerabilities/${vulnId}/convert`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                toast.success('Finding securely attached to Issue board!', { id: toastId });
                fetchData();
            } else {
                const data = await response.json();
                toast.error((t) => (
                    <div className="flex items-center justify-between w-full gap-4">
                        <span>{data.error || 'Failed to convert finding'}</span>
                        <button onClick={() => toast.dismiss(t.id)} className="p-1 hover:bg-black/10 rounded-full transition-colors"><X size={14} /></button>
                    </div>
                ), { id: toastId, duration: Infinity });
            }
        } catch (err: any) {
            toast.error((t) => (
                <div className="flex items-center justify-between w-full gap-4">
                    <span>{err.message || 'Error executing remediation sequence'}</span>
                    <button onClick={() => toast.dismiss(t.id)} className="p-1 hover:bg-black/10 rounded-full transition-colors"><X size={14} /></button>
                </div>
            ), { id: toastId, duration: Infinity });
        } finally {
            setConverting(null);
        }
    };

    if (loading) return (
        <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center p-8">
            <div className="text-center">
                <Terminal className="w-12 h-12 text-[var(--accent-primary)] animate-pulse mx-auto mb-4" />
                <h2 className="text-xs font-black text-[var(--text-secondary)] uppercase tracking-widest animate-pulse italic leading-none">Decrypting Repository...</h2>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] p-8 text-[var(--text-primary)] transition-colors duration-300">
            <div className="max-w-6xl mx-auto">
                {/* Back Link & Actions */}
                <div className="flex items-center justify-between mb-8">
                    <Link to="/security" className="flex items-center gap-2 text-xs font-black text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-all uppercase tracking-widest italic leading-none">
                        <ArrowLeft className="w-4 h-4" />
                        Back to Fleet
                    </Link>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={handleRunScan}
                            disabled={triggering}
                            className="btn-premium flex items-center gap-2 group disabled:opacity-50"
                        >
                            {triggering ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current group-hover:scale-110 transition-transform" />}
                            Run New Audit
                        </button>
                        <a href={repo?.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs font-black text-[var(--accent-primary)] hover:opacity-80 transition-all uppercase tracking-widest italic border-b border-transparent hover:border-[var(--accent-primary)] leading-none">
                            <Github className="w-4 h-4" />
                            Source Code
                        </a>
                    </div>
                </div>

                {/* Main Repo Card */}
                <div className="premium-card p-10 mb-8 relative overflow-hidden group">
                    <div className="flex flex-col md:flex-row md:items-center justify-between relative z-10 gap-8">
                        <div>
                            <div className="flex items-center gap-4 mb-3">
                                <div className="bg-[var(--accent-primary)] p-2.5 rounded-2xl shadow-lg shadow-[var(--accent-primary)]/20">
                                    <Shield className="w-6 h-6 text-white" />
                                </div>
                                <h1 className="text-4xl font-black text-[var(--text-primary)] tracking-tighter italic uppercase leading-none">{repo?.name}</h1>
                            </div>
                            <p className="text-[var(--text-secondary)] font-mono text-[10px] mb-8 tracking-tight uppercase italic">{repo?.url}</p>
                            <div className="flex flex-wrap gap-4">
                                <Badge label={`Risk Score: ${repo?.risk_score || 0}%`} severity={(repo?.risk_score || 0) > 60 ? 'high' : 'low'} />
                                <Badge label={`${vulnerabilities.length} Findings`} severity="info" />
                                <Badge label={`Status: Online`} severity="success" />
                            </div>
                        </div>
                        <div className="text-center md:text-right border-t md:border-t-0 md:border-l border-[var(--border-subtle)] pt-8 md:pt-0 md:pl-12">
                            <div className="text-7xl font-black text-[var(--text-primary)] tracking-tighter italic mb-1 group-hover:scale-110 transition-transform duration-500 leading-none">{100 - (repo?.risk_score || 0)}</div>
                            <div className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic">Health Index</div>
                        </div>
                    </div>
                    {/* Background decoration */}
                    <div className="absolute -right-20 -bottom-20 w-80 h-80 bg-[var(--accent-primary)]/5 rounded-full blur-[100px] pointer-events-none group-hover:bg-[var(--accent-primary)]/10 transition-all duration-700" />
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-8 border-b border-[var(--border-subtle)] mb-8 overflow-x-auto">
                    {(['findings', 'governance', 'access'] as const).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`pb-4 text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap italic leading-none
                                ${activeTab === tab
                                    ? 'text-[var(--accent-primary)] border-b-2 border-[var(--accent-primary)]'
                                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                        >
                            {tab.replace('_', ' ')}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                {activeTab === 'findings' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-2">
                            <FindingsTable 
                                findings={vulnerabilities as any} 
                                onRemediate={(id) => {
                                    if (id) {
                                        setRemediationId(id);
                                    } else {
                                        console.error('[ERROR] Remediation ID is empty');
                                    }
                                }}
                            />
                        </div>
                        <div className="lg:col-span-1 space-y-6">
                            <h2 className="text-xs font-black text-[var(--text-secondary)] uppercase tracking-widest italic leading-none">Audit History</h2>
                            <ScanHistory scans={scans as any} />
                        </div>
                    </div>
                )}

                {activeTab === 'governance' && <GovernanceView policy={policy} repoId={id!} onUpdate={fetchData} />}
                {activeTab === 'access' && <AccessView access={projectAccess} repoId={id!} onUpdate={fetchData} />}
            </div>

            {remediationId && <RemediationPanel key={remediationId} documentId={remediationId} onClose={() => setRemediationId(null)} />}
        </div>
    );
}

function GovernanceView({ policy, repoId, onUpdate }: { policy: any, repoId: string, onUpdate: () => void }) {
    const [updating, setUpdating] = useState(false);
    const updatePolicy = async (profile: string) => {
        setUpdating(true);
        try {
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const token = localStorage.getItem('appwrite_jwt');
            const response = await fetch(`${apiBase}/api/repos/${repoId}/policy`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ policy_name: profile })
            });
            if (response.ok) onUpdate();
        } catch (err) {
            console.error('Error updating policy:', err);
        } finally {
            setUpdating(false);
        }
    };

    return (
        <div className={`grid grid-cols-1 md:grid-cols-3 gap-8 ${updating ? 'opacity-50 grayscale' : ''} transition-all`}>
            <div className="md:col-span-2 space-y-8">
                <div className="premium-card p-8">
                    <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight italic mb-8 italic leading-none">Security Profile</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {['Strict', 'Balanced', 'Relaxed'].map((p) => (
                            <button
                                key={p}
                                onClick={() => updatePolicy(p.toLowerCase())}
                                className={`p-8 rounded-[2rem] border-2 transition-all group relative overflow-hidden
                                    ${policy?.policy_name?.toLowerCase() === p.toLowerCase()
                                        ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/5'
                                        : 'border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/50'}`}
                            >
                                <h4 className={`font-black text-[10px] uppercase tracking-widest italic leading-none relative z-10
                                    ${policy?.policy_name?.toLowerCase() === p.toLowerCase() ? 'text-[var(--accent-primary)]' : 'text-[var(--text-secondary)]group-hover:text-[var(--text-primary)]'}`}>
                                    {p}
                                </h4>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

function AccessView({ access, repoId, onUpdate }: { access: any[], repoId: string, onUpdate: () => void }) {
    const revokeAccess = async (teamId: string) => {
        try {
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const token = localStorage.getItem('appwrite_jwt');
            const response = await fetch(`${apiBase}/api/repos/${repoId}/access`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ team_id: teamId, action: 'revoke' })
            });
            if (response.ok) onUpdate();
        } catch (err) {
            console.error('Error revoking access:', err);
        }
    };

    return (
        <div className="premium-card overflow-hidden">
            <div className="divide-y divide-[var(--border-subtle)]">
                {access.length === 0 ? (
                    <div className="p-16 text-center">
                        <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic lowercase">No authorized clusters detected</p>
                    </div>
                ) : (
                    access.map((a) => (
                        <div key={a.id} className="p-6 flex items-center justify-between hover:bg-[var(--text-primary)]/5 transition-colors group">
                            <div>
                                <p className="font-black text-[var(--text-primary)] uppercase italic leading-none mb-2">{a.teams?.name}</p>
                                <p className="text-[9px] text-[var(--text-secondary)] font-bold tracking-widest font-mono uppercase">ID: {a.team_id}</p>
                            </div>
                            <button onClick={() => revokeAccess(a.team_id)} className="p-3 bg-[var(--status-error)]/10 text-[var(--status-error)] rounded-xl hover:bg-[var(--status-error)] hover:text-white transition-all">
                                <Trash2 className="w-5 h-5" />
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

function Badge({ label, severity }: { label: string, severity: string }) {
    const styles = severity === 'high'
        ? 'bg-[var(--status-error)]/10 text-[var(--status-error)] border-[var(--status-error)]/20 shadow-[0_0_12px_var(--status-error)]/10'
        : severity === 'info'
            ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border-[var(--accent-primary)]/20'
            : 'bg-[var(--status-success)]/10 text-[var(--status-success)] border-[var(--status-success)]/20 shadow-[0_0_12px_var(--status-success)]/10';

    return <span className={`px-5 py-2 rounded-2xl text-[9px] font-black uppercase tracking-widest italic border ${styles} leading-none transition-all hover:scale-105 cursor-default`}>{label}</span>;
}

