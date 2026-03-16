import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { 
    Github, Shield, ArrowLeft, Terminal, RefreshCw, Play, Trash2
} from 'lucide-react';
import { FindingsTable } from '../components/FindingsTable';
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

            // Fetch Policy - Placeholder for now as it's a backend call that used to be Supabase-token based
            // We'll need to update the backend logic separately, but for now we'll maintain the call
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            // In a real migration, we'd get the JWT from Appwrite account.createJWT()
            const policyRes = await fetch(`${apiBase}/api/repos/${id}/policy`);
            if (policyRes.ok) setPolicy(await policyRes.json());

            // Fetch Access
            const accessRes = await fetch(`${apiBase}/api/repos/${id}/access`);
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
        try {
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const response = await fetch(`${apiBase}/api/repos/${id}/scan`, {
                method: 'POST'
            });

            if (!response.ok) {
                const data = await response.json();
                alert(data.error || 'Failed to trigger scan');
            } else {
                fetchData();
            }
        } catch (err) {
            console.error('Error triggering scan:', err);
        } finally {
            setTriggering(false);
        }
    };

    const handleConvertToIssue = async (vulnId: string) => {
        setConverting(vulnId);
        try {
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const response = await fetch(`${apiBase}/api/vulnerabilities/${vulnId}/convert`, {
                method: 'POST'
            });

            if (response.ok) {
                alert('Finding converted to Task successfully!');
                fetchData();
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
                    <button onClick={() => setActiveTab('findings')} className={`pb-4 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'findings' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400 dark:text-slate-300'}`}>Findings</button>
                    <button onClick={() => setActiveTab('governance')} className={`pb-4 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'governance' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400 dark:text-slate-300'}`}>Governance</button>
                    <button onClick={() => setActiveTab('access')} className={`pb-4 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'access' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400 dark:text-slate-300'}`}>Access Control</button>
                </div>

                {activeTab === 'findings' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-2">
                            <FindingsTable findings={vulnerabilities as any} onConvert={handleConvertToIssue} onRemediate={(id) => setRemediationId(id)} convertingId={converting} />
                        </div>
                        <div className="lg:col-span-1">
                            <h2 className="text-sm font-black text-slate-400 uppercase tracking-tighter italic mb-6">Audit History</h2>
                            <ScanHistory scans={scans as any} />
                        </div>
                    </div>
                )}

                {activeTab === 'governance' && <GovernanceView policy={policy} repoId={id!} onUpdate={fetchData} />}
                {activeTab === 'access' && <AccessView access={projectAccess} repoId={id!} onUpdate={fetchData} />}
            </div>

            {remediationId && <RemediationPanel vulnerabilityId={remediationId} onClose={() => setRemediationId(null)} />}
        </div>
    );
}

function GovernanceView({ policy, repoId, onUpdate }: { policy: any, repoId: string, onUpdate: () => void }) {
    const [updating, setUpdating] = useState(false);
    const updatePolicy = async (profile: string) => {
        setUpdating(true);
        try {
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const response = await fetch(`${apiBase}/api/repos/${repoId}/policy`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
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
        <div className={`grid grid-cols-1 md:grid-cols-3 gap-8 ${updating ? 'opacity-50' : ''}`}>
            <div className="md:col-span-2 space-y-8">
                <div className="bg-white dark:bg-slate-900 rounded-[2rem] p-8 border border-slate-200 dark:border-slate-700">
                    <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight italic mb-6">Security Profile</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {['Strict', 'Balanced', 'Relaxed'].map((p) => (
                            <button key={p} onClick={() => updatePolicy(p.toLowerCase())} className={`p-6 rounded-2xl border-2 transition-all ${policy?.policy_name?.toLowerCase() === p.toLowerCase() ? 'border-blue-600 bg-blue-50' : 'border-slate-100 dark:border-slate-800'}`}>
                                <h4 className="font-black text-xs uppercase tracking-widest mb-2">{p}</h4>
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
            const response = await fetch(`${apiBase}/api/repos/${repoId}/access`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ team_id: teamId, action: 'revoke' })
            });
            if (response.ok) onUpdate();
        } catch (err) {
            console.error('Error revoking access:', err);
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-slate-700 divide-y divide-slate-100">
            {access.length === 0 ? (
                <div className="p-12 text-center text-slate-400">No teams have access yet</div>
            ) : (
                access.map((a) => (
                    <div key={a.id} className="p-6 flex items-center justify-between">
                        <div>
                            <p className="font-black text-slate-900 dark:text-white uppercase">{a.teams?.name}</p>
                            <p className="text-[10px] text-slate-400 font-bold italic">Team ID: {a.team_id}</p>
                        </div>
                        <button onClick={() => revokeAccess(a.team_id)} className="p-2 text-slate-300 hover:text-red-500"><Trash2 className="w-5 h-5" /></button>
                    </div>
                ))
            )}
        </div>
    );
}

function Badge({ label, severity }: { label: string, severity: string }) {
    const styles = severity === 'high' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100';
    return <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest italic border ${styles}`}>{label}</span>;
}
