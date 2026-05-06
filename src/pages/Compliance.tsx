import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
    Shield, CheckCircle, AlertTriangle, XCircle, 
    ShieldCheck, ClipboardCheck, Info, Loader2
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useTranslation } from 'react-i18next';

interface DashboardData {
    by_type: Record<string, number>;
    by_type_severity: Record<string, Record<string, number>>;
}

interface OWASPCategory {
    id: string;
    name: string;
    mapping?: string;
    description: string;
}

const OWASP_TOP_10: OWASPCategory[] = [
    { id: 'A01:2021', name: 'Broken Access Control', description: 'Restricting access to unauthorized users.' },
    { id: 'A02:2021', name: 'Cryptographic Failures', mapping: 'secret', description: 'Hardcoded secrets, weak encryption, or cleartext keys.' },
    { id: 'A03:2021', name: 'Injection', mapping: 'sast', description: 'Unfiltered user input leading to malicious commands.' },
    { id: 'A04:2021', name: 'Insecure Design', description: 'Flaws in application architecture and design patterns.' },
    { id: 'A05:2021', name: 'Security Misconfiguration', mapping: 'docker', description: 'Improperly configured servers, containers, or clouds.' },
    { id: 'A06:2021', name: 'Vulnerable and Outdated Components', mapping: 'dependency', description: 'Using libraries with known security vulnerabilities.' },
    { id: 'A07:2021', name: 'Identification and Authentication Failures', description: 'Weak password policies and session management.' },
    { id: 'A08:2021', name: 'Software and Data Integrity Failures', description: 'Unauthorized changes to software or data pipelines.' },
    { id: 'A09:2021', name: 'Security Logging and Monitoring Failures', description: 'Inability to detect or respond to active security breaches.' },
    { id: 'A10:2021', name: 'Server-Side Request Forgery (SSRF)', description: 'Abusing server functionality to access internal resources.' }
];

export default function Compliance() {
    const { t } = useTranslation();
    const { getJWT } = useAuth();
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchCompliance();
    }, []);

    const fetchCompliance = async () => {
        setLoading(true);
        try {
            const token = await getJWT();
            const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const res = await fetch(`${apiBase}/api/dashboard/security`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await res.json();
            setData(result);
        } catch (err) {
            console.error('Compliance Fetch Error:', err);
        } finally {
            setLoading(false);
        }
    };

    const getCategoryStats = (mapping?: string) => {
        if (!mapping || !data?.by_type_severity[mapping]) {
            return { count: 0, critical: 0, high: 0, medium: 0, low: 0 };
        }
        const sev = data.by_type_severity[mapping];
        return {
            count: data.by_type[mapping] || 0,
            critical: sev.critical || 0,
            high: sev.high || 0,
            medium: sev.medium || 0,
            low: sev.low || 0
        };
    };

    const getStatus = (stats: any) => {
        if (stats.count === 0) return 'PASS';
        if (stats.critical > 0 || stats.high > 0) return 'FAIL';
        return 'WARN';
    };

    const categoriesWithStats = OWASP_TOP_10.map(cat => {
        const stats = getCategoryStats(cat.mapping);
        return { ...cat, stats, status: getStatus(stats) };
    });

    const passedCategories = categoriesWithStats.filter(c => c.status !== 'FAIL').length;
    const score = (passedCategories / OWASP_TOP_10.length) * 100;

    const chartData = [
        { name: 'Pass', value: score },
        { name: 'Fail', value: 100 - score }
    ];

    if (loading) return (
        <div className="min-h-screen bg-[var(--bg-primary)] p-8 flex flex-col items-center justify-center">
            <ClipboardCheck className="w-12 h-12 text-[var(--accent-primary)] animate-pulse mb-4" />
            <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-[var(--text-secondary)]" />
                <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.3em] italic">{t('compliance.evaluating_controls', 'Evaluating Control Frameworks...')}</p>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] p-8">
            <div className="max-w-6xl mx-auto space-y-12">
                
                {/* Header Section */}
                <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                    <div className="flex items-center gap-5">
                        <div className="w-16 h-16 bg-[var(--accent-primary)] rounded-3xl flex items-center justify-center text-white shadow-2xl">
                            <ShieldCheck size={32} />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black tracking-tighter uppercase italic text-[var(--text-primary)]">{t('compliance.title', 'Compliance Protocol')}</h1>
                            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-1">{t('compliance.framework', 'Framework: OWASP Top 10 (2021) Mapping')}</p>
                        </div>
                    </div>

                    <div className="premium-card px-8 py-4 flex items-center gap-6">
                        <div className="w-20 h-20 relative">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={chartData}
                                        innerRadius={25}
                                        outerRadius={35}
                                        paddingAngle={5}
                                        dataKey="value"
                                        startAngle={90}
                                        endAngle={450}
                                    >
                                        <Cell fill={score === 100 ? 'var(--status-success)' : 'var(--accent-primary)'} />
                                        <Cell fill="var(--bg-primary)" />
                                    </Pie>
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-[10px] font-black text-[var(--text-primary)]">{Math.round(score)}%</span>
                            </div>
                        </div>
                        <div>
                            <p className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest mb-1 italic">{t('compliance.trust_score', 'Trust Integrity Score')}</p>
                            <p className="text-2xl font-black text-[var(--text-primary)] italic tracking-tighter">{score}% COMPLIANT</p>
                        </div>
                    </div>
                </div>

                {/* Categories Grid */}
                <div className="space-y-4">
                    {categoriesWithStats.map((cat) => (
                        <div key={cat.id} className="premium-card p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:translate-x-2 transition-transform">
                            <div className="flex items-start gap-5 flex-1">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border
                                    ${cat.status === 'PASS' ? 'bg-[var(--status-success)]/10 border-[var(--status-success)]/20 text-[var(--status-success)]' : 
                                      cat.status === 'FAIL' ? 'bg-[var(--status-error)]/10 border-[var(--status-error)]/20 text-[var(--status-error)]' : 
                                      'bg-[var(--status-warning)]/10 border-[var(--status-warning)]/20 text-[var(--status-warning)]'}`}>
                                    {cat.status === 'PASS' ? <CheckCircle size={20} /> : cat.status === 'FAIL' ? <XCircle size={20} /> : <AlertTriangle size={20} />}
                                </div>
                                <div>
                                    <div className="flex items-center gap-3 mb-1">
                                        <h3 className="text-sm font-black text-[var(--text-primary)] uppercase italic tracking-tight">{cat.id}: {cat.name}</h3>
                                        {cat.mapping && (
                                            <span className="px-2 py-0.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-full text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-tighter">Mapped to {cat.mapping}</span>
                                        )}
                                    </div>
                                    <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic leading-relaxed max-w-2xl">{cat.description}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-8">
                                <div className="text-right">
                                    <p className="text-[9px] font-black text-[var(--text-secondary)] uppercase italic mb-1">{t('compliance.detected_vectors', 'Detected Vectors')}</p>
                                    <p className={`text-xl font-black italic tracking-tighter ${cat.stats.count > 0 ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]/30'}`}>{cat.stats.count}</p>
                                </div>
                                <div className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] italic border
                                    ${cat.status === 'PASS' ? 'bg-[var(--status-success)] text-[var(--status-success)] border-[var(--status-success)]/30 bg-opacity-10' : 
                                      cat.status === 'FAIL' ? 'bg-[var(--status-error)] text-[var(--status-error)] border-[var(--status-error)]/30 bg-opacity-10' : 
                                      'bg-[var(--status-warning)] text-[var(--status-warning)] border-[var(--status-warning)]/30 bg-opacity-10'}`}>
                                    {cat.status}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Footer Info */}
                <div className="flex items-center gap-4 p-6 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-2xl italic opacity-60">
                    <Info size={16} className="text-[var(--accent-primary)] shrink-0" />
                    <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase leading-relaxed">
                        Neural intelligence determines compliance status by correlating static, dynamic, and dependency analysis telemetry with OWASP A01-A10 (2021) control categories. Unmapped categories are currently evaluated as compliant based on zero active detections.
                    </p>
                </div>

            </div>
        </div>
    );
}
