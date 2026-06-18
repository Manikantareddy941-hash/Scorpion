import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Activity, Bug, CheckCircle2, ChevronRight, 
  BarChart3, Filter, Search, ShieldAlert, ShieldCheck
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, Cell 
} from 'recharts';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import toast from 'react-hot-toast';

export default function AntipatternsDetail() {
  const { scanId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [findings, setFindings] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'issues' | 'dismissed'>('issues');

  useEffect(() => {
    const fetchData = async () => {
      if (!scanId) return;
      setLoading(true);
      try {
        const res = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
          Query.equal('scan_result_id', scanId),
          Query.equal('tool', 'semgrep'),
          Query.limit(200)
        ]);
        setFindings(res.documents);
      } catch (err) {
        toast.error('Failed to load antipatterns');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [scanId]);

  const groupedFindings = useMemo(() => {
    const grouped = findings.reduce((acc: any, f: any) => {
      const key = f.message?.split('\n')[0].substring(0, 100) || 'Unknown Issue';
      if (!acc[key]) {
        acc[key] = { 
          message: key, 
          tool: f.tool, 
          severity: f.severity, 
          files: new Set(), 
          count: 0,
          id: f.$id
        };
      }
      acc[key].files.add(f.file_path);
      acc[key].count++;
      return acc;
    }, {});
    return Object.values(grouped);
  }, [findings]);

  const chartData = useMemo(() => [
    { name: 'Critical', value: groupedFindings.filter((r: any) => r.severity === 'critical').length, color: '#ef4444' },
    { name: 'High', value: groupedFindings.filter((r: any) => r.severity === 'high').length, color: '#f97316' },
    { name: 'Medium', value: groupedFindings.filter((r: any) => r.severity === 'medium').length, color: '#eab308' },
    { name: 'Low', value: groupedFindings.filter((r: any) => r.severity === 'low').length, color: '#22c55e' },
  ], [groupedFindings]);

  if (loading) return <div className="flex-1 flex flex-col items-center justify-center min-h-[400px]"><Activity className="animate-spin text-[var(--accent-primary)]" /></div>;

  return (
    <div className="flex-1 w-full max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 bg-[var(--bg-card)] rounded-lg border border-[var(--border-subtle)]"><ArrowLeft size={18} /></button>
          <div>
            <h1 className="text-2xl font-black text-[var(--text-primary)] uppercase italic tracking-tight">Antipattern Issues</h1>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-1">Found in Scan {scanId}</p>
          </div>
        </div>
      </div>

      {/* Analytics Section */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
        <div className="lg:col-span-3 bg-[var(--bg-card)] rounded-2xl border border-[var(--border-subtle)] p-6 shadow-sm">
          <h3 className="text-[11px] font-black text-[var(--text-secondary)] uppercase tracking-widest mb-6 flex items-center gap-2">
            <BarChart3 size={12} /> Severity Distribution
          </h3>
          <div style={{ width: '100%', height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-subtle)" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fontWeight: 700, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fontWeight: 700, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '8px', fontSize: '10px' }}
                  cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-subtle)] p-6 shadow-sm flex flex-col justify-center text-center">
          <div className="text-5xl font-black text-[var(--text-primary)] mb-2 italic tracking-tighter">{groupedFindings.length}</div>
          <div className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Total Unique Issues</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-8 border-b border-[var(--border-subtle)] mb-6">
        <button 
          onClick={() => setActiveTab('issues')}
          className={`pb-4 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'issues' ? 'text-[var(--accent-primary)] border-b-2 border-[var(--accent-primary)]' : 'text-[var(--text-secondary)]'}`}
        >
          Antipattern Issues ({groupedFindings.length})
        </button>
        <button 
          onClick={() => setActiveTab('dismissed')}
          className={`pb-4 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'dismissed' ? 'text-[var(--accent-primary)] border-b-2 border-[var(--accent-primary)]' : 'text-[var(--text-secondary)]'}`}
        >
          Dismissed (0)
        </button>
      </div>

      {/* Table */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-subtle)] overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[var(--bg-primary)] border-b border-[var(--border-subtle)]">
              <th className="px-6 py-4 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Issue</th>
              <th className="px-6 py-4 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Type</th>
              <th className="px-6 py-4 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Severity</th>
              <th className="px-6 py-4 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Likelihood</th>
              <th className="px-6 py-4 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Issues Count</th>
              <th className="px-6 py-4 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {groupedFindings.map((row: any, i) => (
              <tr key={i} className="hover:bg-[var(--bg-primary)] transition-colors group">
                <td className="px-6 py-5">
                  <div className="text-xs font-bold text-[var(--text-primary)] leading-relaxed max-w-md truncate">{row.message}</div>
                </td>
                <td className="px-6 py-5">
                  <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-500 text-[9px] font-black uppercase tracking-widest">
                    {row.tool === 'semgrep' ? 'Code Smell' : 'Bug'}
                  </span>
                </td>
                <td className="px-6 py-5">
                   <div className="flex items-center gap-2">
                     <div className={`w-1.5 h-1.5 rounded-full ${
                        row.severity === 'critical' ? 'bg-red-500 shadow-[0_0_8px_#ef4444]' : 
                        row.severity === 'high' ? 'bg-orange-500' : 
                        row.severity === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
                     }`} />
                     <span className={`text-[10px] font-black uppercase tracking-widest ${
                        row.severity === 'critical' ? 'text-red-500' : 
                        row.severity === 'high' ? 'text-orange-500' : 
                        row.severity === 'medium' ? 'text-yellow-500' : 'text-green-500'
                     }`}>
                        {row.severity === 'critical' ? 'Critical' : row.severity === 'high' ? 'Major' : 'Minor'}
                     </span>
                   </div>
                </td>
                <td className="px-6 py-5 text-[10px] font-bold text-[var(--text-secondary)] uppercase">
                  {row.files.size} files affected
                </td>
                <td className="px-6 py-5 text-[10px] font-bold text-[var(--text-primary)] uppercase">
                  {row.count} issues
                </td>
                <td className="px-6 py-5 text-right">
                  <button 
                    onClick={() => navigate(`/scans/${scanId}/sast?rule=${encodeURIComponent(row.message)}`)}
                    className="p-2 text-[var(--text-secondary)] hover:text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 rounded-lg transition-all"
                  >
                    <ChevronRight size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
