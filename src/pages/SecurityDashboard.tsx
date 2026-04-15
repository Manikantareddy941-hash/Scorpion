import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import SecurityPulseCard from '../components/SecurityPulseCard';
import {
    Shield, CheckCircle, XCircle,
    RefreshCw, Play, ExternalLink,
    Clock, Terminal, Bug, AlertTriangle
} from 'lucide-react';

interface ScanResult {
    $id: string;
    repo_id: string;
    repo_url: string;
    status: 'queued' | 'in_progress' | 'completed' | 'failed';
    details: any;
    $createdAt: string;
    repo_name?: string;
}

interface RepoMetric {
    $id: string;
    name: string;
    risk_score: number;
    vulnerability_count: number;
}

interface DashboardStats {
    healthScore: number;
    criticalRisks: number;
    patchRate: number;
    avgFixTime: number;
    totalVulns: number;
}

export default function SecurityDashboard() {
    const [results, setResults] = useState<ScanResult[]>([]);
    const [repos, setRepos] = useState<RepoMetric[]>([]);
    const [stats, setStats] = useState<DashboardStats>({
        healthScore: 100,
        criticalRisks: 0,
        patchRate: 0,
        avgFixTime: 0,
        totalVulns: 0
    });
    const [loading, setLoading] = useState(true);
    const [triggering, setTriggering] = useState<string | null>(null);

    useEffect(() => {
        fetchDashboardData();
        const interval = setInterval(fetchDashboardData, 30000); // 30s polling
        return () => clearInterval(interval);
    }, []);

    const fetchDashboardData = async () => {
        try {
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const jwt = localStorage.getItem('appwrite_jwt');

            // 1. Fetch repositories (still needed for list/distribution)
            console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.REPOSITORIES}`);
            if (!COLLECTIONS.REPOSITORIES) throw new Error("collectionId is undefined");
            const repoData = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
                Query.limit(100)
            ]);
            const repositories = repoData.documents as unknown as RepoMetric[];
            setRepos(repositories);

            // 2. Fetch aggregate stats from backend (Source of Truth)
            const statsRes = await fetch(`${apiBase}/api/reports/stats?scope=global`, {
                headers: { 'Authorization': `Bearer ${jwt}` }
            });

            if (statsRes.ok) {
                const data = await statsRes.json();
                const s = data.stats;
                setStats({
                    healthScore: 100 - (s.avg_risk_score || 0),
                    criticalRisks: s.severity_breakdown?.critical || 0,
                    patchRate: 0, // Not provided by stats yet
                    avgFixTime: 12,
                    totalVulns: s.total_findings || 0
                });
            }

            // 3. Fetch scan results (for the live audit trail)
            console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.SCANS}`);
            if (!COLLECTIONS.SCANS) throw new Error("collectionId is undefined");
            const scanData = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
                Query.orderDesc('startedAt'), // Use startedAt as per requirements
                Query.limit(50)
            ]);
            
            setResults(scanData.documents.map((item: any) => {
                const repo = repositories.find(r => r.$id === item.repo_id);
                return {
                    ...item,
                    repo_name: repo?.name || 'Unknown Repo',
                    repo_url: (repo as any)?.url || '#'
                };
            }));

        } catch (error) {
            console.error('Error fetching dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };


    const handleRunScan = async (repoId: string) => {
        setTriggering(repoId);
        try {
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const jwt = localStorage.getItem('appwrite_jwt');
            const response = await fetch(`${apiBase}/api/repos/${repoId}/scan`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${jwt}`
                }
            });

            if (!response.ok) {
                const data = await response.json();
                alert(data.error || 'Failed to trigger scan');
            } else {
                fetchDashboardData();
            }
        } catch (err) {
            console.error('Error triggering scan:', err);
        } finally {
            setTriggering(null);
        }
    };


    if (loading) return (
        <div className="min-h-screen bg-[var(--bg-primary)] p-8 flex items-center justify-center">
            <div className="text-center">
                <Shield className="w-12 h-12 text-[var(--accent-primary)] animate-pulse mx-auto mb-4" />
                <h2 className="text-lg font-black text-[var(--text-primary)] uppercase tracking-widest animate-pulse">Scanning Perimeter...</h2>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] p-8 text-[var(--text-primary)]">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-6">
                    <div className="flex items-center gap-4">
                        <div className="bg-[var(--accent-primary)] p-3 rounded-2xl shadow-lg shadow-[var(--accent-primary)]/20">
                            <Shield className="w-8 h-8 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black tracking-tighter italic uppercase text-[var(--text-primary)] leading-none">Fleet Security</h1>
                            <p className="text-[var(--text-secondary)] text-xs font-bold uppercase tracking-widest mt-1">Real-time Perimeter Defense</p>
                        </div>
                    </div>
                </div>

                <div className="mb-12">
                    <SecurityPulseCard
                        healthScore={stats.healthScore}
                        criticalRisks={stats.criticalRisks}
                        patchRate={stats.patchRate}
                        avgFixTime={stats.avgFixTime}
                        managedRepos={repos.length}
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <MetricCard label="Active Findings" value={stats.totalVulns} icon={<Bug className="text-[var(--status-error)]" />} />
                    <MetricCard label="High Risk Targets" value={repos.filter(r => r.risk_score > 70).length} icon={<AlertTriangle className="text-[var(--status-warning)]" />} />
                    <MetricCard label="Audit Logs" value={results.length} icon={<Terminal className="text-[var(--accent-primary)]" />} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    <div className="lg:col-span-3 space-y-6">
                        <div className="bg-[var(--bg-card)] rounded-3xl shadow-sm border border-[var(--border-subtle)] overflow-hidden">
                            <div className="p-6 border-b border-[var(--border-subtle)] flex justify-between items-center bg-[var(--text-primary)]/5 backdrop-blur-sm">
                                <div className="flex items-center gap-3">
                                    <Clock className="w-5 h-5 text-[var(--text-secondary)]" />
                                    <h2 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-widest italic">Live Audit Trail</h2>
                                </div>
                                <button onClick={fetchDashboardData} className="p-2 text-[var(--text-secondary)] hover:text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/5 rounded-xl transition-all"><RefreshCw className="w-5 h-5" /></button>
                            </div>

                            <div className="divide-y divide-[var(--border-subtle)]">
                                {results.length === 0 ? (
                                    <div className="p-20 text-center flex flex-col items-center text-[var(--text-secondary)] uppercase tracking-widest text-sm font-bold">No Audit Logs Found</div>
                                ) : (
                                    results.map((scan: any) => (
                                        <ScanItem key={scan.$id} scan={scan} onRescan={handleRunScan} isTriggering={triggering === scan.repo_id} />
                                    ))
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="lg:col-span-1 space-y-6">
                        <RiskDistribution repos={repos} />
                        <DocumentationCard />
                    </div>
                </div>
            </div>
        </div>
    );
}

function MetricCard({ label, value, icon }: { label: string, value: any, icon: any }) {
    return (
        <div className="bg-[var(--bg-card)] p-6 rounded-3xl shadow-sm border border-[var(--border-subtle)] flex items-center justify-between group hover:border-[var(--accent-primary)]/30 transition-all">
            <div>
                <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest mb-1 italic">{label}</p>
                <p className="text-3xl font-black text-[var(--text-primary)] tracking-tighter italic">{value}</p>
            </div>
            <div className="bg-[var(--bg-secondary)] p-3 rounded-2xl group-hover:bg-[var(--accent-primary)]/10 transition-colors">{icon}</div>
        </div>
    );
}

function ScanItem({ scan, onRescan, isTriggering }: { scan: ScanResult, onRescan: (id: string) => void, isTriggering: boolean }) {
    return (
        <div className="p-6 hover:bg-[var(--text-primary)]/5 transition-all group">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-2xl ${scan.status === 'completed' ? 'bg-[var(--status-success)]/10' : scan.status === 'failed' ? 'bg-[var(--status-error)]/10' : 'bg-[var(--accent-primary)]/10 animate-pulse'}`}>
                        {scan.status === 'completed' ? <CheckCircle className="w-6 h-6 text-[var(--status-success)]" /> : scan.status === 'failed' ? <XCircle className="w-6 h-6 text-[var(--status-error)]" /> : <RefreshCw className="w-6 h-6 text-[var(--accent-primary)] animate-spin" />}
                    </div>
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <span className="font-black text-lg text-[var(--text-primary)] tracking-tight leading-none group-hover:text-[var(--accent-primary)] transition-colors uppercase italic">{scan.repo_name}</span>
                            <span className="text-[10px] font-mono text-[var(--text-secondary)] opacity-60 uppercase tracking-widest">#{scan.$id.slice(0, 8)}</span>
                        </div>
                        <div className="flex items-center gap-4 text-[10px] font-bold text-[var(--text-secondary)] font-black uppercase tracking-widest italic">
                            <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(scan.$createdAt).toLocaleTimeString()}</span>
                            <span className={scan.status === 'completed' ? 'text-[var(--status-success)]' : scan.status === 'failed' ? 'text-[var(--status-error)]' : 'text-[var(--accent-primary)]'}>{scan.status}</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button onClick={() => onRescan(scan.repo_id)} disabled={isTriggering || scan.status === 'in_progress'} className="bg-[var(--accent-primary)] text-white p-3 rounded-xl hover:brightness-110 transition-all shadow-lg">
                        {isTriggering ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                    </button>
                    <Link to={`/projects/${scan.repo_id}`} className="bg-[var(--bg-card)] p-3 rounded-xl border border-[var(--border-subtle)] hover:bg-white/5 transition-all">
                        <ExternalLink className="w-4 h-4" />
                    </Link>
                </div>
            </div>
        </div>
    );
}

function RiskDistribution({ repos }: { repos: RepoMetric[] }) {
    const critical = repos.filter(r => r.risk_score > 70).length;
    const medium = repos.filter(r => r.risk_score > 30 && r.risk_score <= 70).length;
    const low = repos.filter(r => r.risk_score <= 30).length;

    return (
        <div className="bg-[var(--bg-card)] p-6 rounded-3xl shadow-sm border border-[var(--border-subtle)]">
            <h2 className="text-sm font-black text-[var(--text-secondary)] uppercase tracking-widest mb-6 italic">Health Distribution</h2>
            <div className="space-y-4">
                <DistributionBar label="CRITICAL RISK" count={critical} total={repos.length} color="bg-[var(--status-error)]" />
                <DistributionBar label="ELEVATED RISK" count={medium} total={repos.length} color="bg-[var(--status-warning)]" />
                <DistributionBar label="SECURE BASELINE" count={low} total={repos.length} color="bg-[var(--status-success)]" />
            </div>
        </div>
    );
}

function DistributionBar({ label, count, total, color }: { label: string, count: number, total: number, color: string }) {
    const percentage = total > 0 ? (count / total) * 100 : 0;
    return (
        <div>
            <div className="flex justify-between text-[10px] font-black uppercase tracking-widest mb-1 italic">
                <span>{label}</span>
                <span>{count} REPOS</span>
            </div>
            <div className="h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                <div className={`h-full ${color} transition-all duration-1000`} style={{ width: `${percentage}%` }} />
            </div>
        </div>
    );
}

function DocumentationCard() {
    return (
        <div className="bg-gradient-to-br from-[var(--accent-primary)] to-[var(--accent-secondary)] p-6 rounded-3xl text-white relative overflow-hidden group">
            <h3 className="text-lg font-black uppercase italic leading-none mb-2">Audit Compliance</h3>
            <p className="text-[10px] font-bold uppercase text-white/80 mb-4">View security policy docs</p>
            <Shield className="absolute -right-8 -bottom-8 w-32 h-32 opacity-10 group-hover:scale-110 transition-transform" />
        </div>
    );
}
