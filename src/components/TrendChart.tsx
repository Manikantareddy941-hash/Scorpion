import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { Loader2, Activity } from 'lucide-react';

export default function TrendChart() {
    const { getJWT } = useAuth();
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [days, setDays] = useState(30);

    const [filters, setFilters] = useState({
        Critical: true,
        High: true,
        Medium: true,
        Low: true
    });

    useEffect(() => {
        const fetchTrends = async () => {
            setLoading(true);
            try {
                const token = await getJWT();
                const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
                
                const response = await fetch(`${apiBase}/api/analytics/trends?days=${days}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                if (response.ok) {
                    const result = await response.json();
                    // Optional: Format dates to be more readable
                    const formattedData = result.map((item: any) => ({
                        ...item,
                        displayDate: new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                    }));
                    setData(formattedData);
                }
            } catch (err) {
                console.error('Failed to fetch trend data:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchTrends();
    }, [days, getJWT]);

    const toggleFilter = (severity: keyof typeof filters) => {
        setFilters(prev => ({ ...prev, [severity]: !prev[severity] }));
    };

    return (
        <div className="premium-card p-6 md:p-8 relative overflow-hidden group flex flex-col h-full w-full">
            <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                <Activity className="w-24 h-24" />
            </div>

            <div className="relative z-10 flex flex-col h-full w-full">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
                    <div>
                        <h2 className="text-lg font-black text-[var(--text-primary)] uppercase italic tracking-tighter">CVE Trend Analysis</h2>
                        <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-1 font-mono">Vulnerability Discovery Rate</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-4">
                        <div className="flex bg-[var(--bg-primary)] p-1 rounded-xl border border-[var(--border-subtle)]">
                            {[7, 30, 90].map(d => (
                                <button
                                    key={d}
                                    onClick={() => setDays(d)}
                                    className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${days === d ? 'bg-[var(--accent-primary)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                                >
                                    {d}D
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap gap-3 mb-6">
                    {[
                        { key: 'Critical', color: '#ff5252' },
                        { key: 'High', color: '#ff8a80' },
                        { key: 'Medium', color: '#ffd740' },
                        { key: 'Low', color: '#00ffcc' }
                    ].map(sev => (
                        <button
                            key={sev.key}
                            onClick={() => toggleFilter(sev.key as any)}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${filters[sev.key as keyof typeof filters] ? 'bg-[var(--bg-primary)]' : 'opacity-40 grayscale'}`}
                            style={{ borderColor: filters[sev.key as keyof typeof filters] ? sev.color + '40' : 'var(--border-subtle)' }}
                        >
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: sev.color }} />
                            <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: filters[sev.key as keyof typeof filters] ? sev.color : 'var(--text-secondary)' }}>
                                {sev.key}
                            </span>
                        </button>
                    ))}
                </div>

                <div className="flex-1 w-full min-h-[300px]">
                    {loading ? (
                        <div className="w-full h-full flex items-center justify-center">
                            <Loader2 className="w-6 h-6 text-[var(--text-secondary)] animate-spin" />
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorCritical" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#ff5252" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#ff5252" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorHigh" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#ff8a80" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#ff8a80" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorMedium" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#ffd740" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#ffd740" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorLow" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#00ffcc" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#00ffcc" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="displayDate" stroke="var(--border-subtle)" tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} tickMargin={10} minTickGap={20} />
                                <YAxis stroke="var(--border-subtle)" tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} />
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                                <Tooltip
                                    contentStyle={{
                                        background: 'var(--bg-card)',
                                        border: '1px solid var(--border-subtle)',
                                        borderRadius: '12px',
                                        fontSize: '10px',
                                        fontWeight: 'bold',
                                        textTransform: 'uppercase'
                                    }}
                                />
                                {filters.Low && <Area type="monotone" dataKey="Low" stackId="1" stroke="#00ffcc" fill="url(#colorLow)" /> }
                                {filters.Medium && <Area type="monotone" dataKey="Medium" stackId="1" stroke="#ffd740" fill="url(#colorMedium)" /> }
                                {filters.High && <Area type="monotone" dataKey="High" stackId="1" stroke="#ff8a80" fill="url(#colorHigh)" /> }
                                {filters.Critical && <Area type="monotone" dataKey="Critical" stackId="1" stroke="#ff5252" fill="url(#colorCritical)" /> }
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>
        </div>
    );
}
