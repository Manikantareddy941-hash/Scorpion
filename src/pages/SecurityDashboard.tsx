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

export default function SecurityDashboard() {
    const { accessToken } = useAuth();
    const navigate = useNavigate(); // ✅ navigation hook

    const [results, setResults] = useState<ScanResult[]>([]);
    const [repos, setRepos] = useState<RepoMetric[]>([]);
    const [loading, setLoading] = useState(true);
    const [triggering, setTriggering] = useState<string | null>(null);

    useEffect(() => {
        fetchDashboardData();
        const interval = setInterval(fetchDashboardData, 30000);
        return () => clearInterval(interval);
    }, []);

    const fetchDashboardData = async () => {
        try {

            // Fetch scan results
            const scanData = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
                Query.orderDesc('$createdAt'),
                Query.limit(50)
            ]);
            
            // Fetch vulnerabilities for stats
            const vulnData = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
                Query.limit(1000)
            ]);
            const allVulns = vulnData.documents as any[];


        } catch (error) {
            console.error('Error fetching dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleRunScan = async (repoId: string) => {
        setTriggering(repoId);
        try {
            });
            fetchDashboardData();
        } catch (err: any) {
            console.error('Error triggering scan:', err);
            alert(err.message || 'Failed to trigger scan');
        } finally {
            setTriggering(null);
        }
    };

    if (loading) return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-800/50 p-8 flex items-center justify-center">
            <div className="text-center">
                <Shield className="w-12 h-12 text-blue-600 animate-pulse mx-auto mb-4" />
                <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-widest animate-pulse">
                    Scanning Perimeter...
                </h2>
            </div>
        </div>
    );

    const avgRisk = repos.length > 0
        ? Math.round(repos.reduce((acc, r) => acc + (r.risk_score || 0), 0) / repos.length)
        : 0;

    const healthIndex = 100 - avgRisk;
    const criticalRepos = repos.filter(r => r.risk_score > 70).length;
    const totalVulns = repos.reduce((acc, r) => acc + (r.vulnerability_count || 0), 0);

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-800/50 p-8 text-slate-900 dark:text-white">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-6">
                    <div className="flex items-center gap-4">
                        <div className="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-200">
                            <Shield className="w-8 h-8 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black tracking-tighter italic uppercase">Fleet Security</h1>
                            <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">
                                Real-time Perimeter Defense
                            </p>
                        </div>
                    </div>

                    <Link
                        to="/"
                        className="inline-flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-2xl hover:bg-black transition font-black uppercase tracking-widest text-xs shadow-lg"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Control Center
                    </Link>
                </div>

                        </div>
                    </div>

                    <div className="lg:col-span-1 space-y-6">
                        <RiskDistribution repos={repos} />
                        <DocumentationCard navigate={navigate} /> {/* ✅ clickable */}
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ---------- COMPONENTS ---------- */

function MetricCard({ label, value, icon }: any) {
    return (
        <div className="bg-white p-6 rounded-3xl border flex justify-between">
            <div>
        </div>
    );
}

function ScanItem({ scan, onRescan, isTriggering }: any) {
    return (
            </div>
        </div>
    );
}

function RiskDistribution({ repos }: any) {
    return (
        <div className="bg-white p-6 rounded-3xl border">
            <h2 className="text-sm font-bold mb-4">Health Distribution</h2>
            <p>Total Repos: {repos.length}</p>
        </div>
    );
}

/* ✅ CLICKABLE CARD */
function DocumentationCard({ navigate }: any) {
    return (
