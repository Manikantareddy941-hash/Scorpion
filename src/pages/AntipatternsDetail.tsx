import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Bug, CheckCircle2, ChevronRight,
  BarChart3, Filter, Search, ShieldAlert, ShieldCheck
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, Cell 
} from 'recharts';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import toast from 'react-hot-toast';
import SeverityBadge from '../components/SeverityBadge';
import Button from '../components/Button';
import { SkeletonTableRows } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';

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

  return (
    <div className="flex-1 w-full max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Button variant="ghost" iconOnly onClick={() => navigate(-1)}><ArrowLeft size={18} /></Button>
          <div>
            <h1 className="text-2xl font-black text-[var(--text-primary)] uppercase italic tracking-tight">Antipattern Issues</h1>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-1">Found in Scan {scanId}</p>
          </div>
        </div>
      </div>

      {/* Analytics Section */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
        <div className="card lg:col-span-3 bg-neutral-900 rounded-lg border border-neutral-800 p-6 shadow-sm">
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
        <div className="card bg-neutral-900 rounded-lg border border-neutral-800 p-6 shadow-sm flex flex-col justify-center text-center">
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
      {!loading && groupedFindings.length === 0 ? (
        <EmptyState icon={ShieldCheck} message="No antipatterns detected" />
      ) : (
        <div className="card bg-neutral-900 rounded-lg border border-neutral-800 overflow-hidden shadow-sm">
          <div className="max-h-[70vh] overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="sticky top-0 z-10 bg-neutral-900 border-b border-neutral-800">
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Issue</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Type</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Severity</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide text-right">Files</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide text-right">Issues</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60">
                {loading ? (
                  <SkeletonTableRows rows={6} cols={6} />
                ) : (
                  groupedFindings.map((row: any, i) => (
                    <tr key={i} className={`hover:bg-neutral-800/40 transition-colors group ${i % 2 === 1 ? 'bg-white/[0.02]' : ''}`}>
                      <td className="px-4 py-2.5">
                        <div className="text-xs font-bold text-[var(--text-primary)] leading-relaxed max-w-md truncate">{row.message}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-500 text-[9px] font-black uppercase tracking-widest">
                          {row.tool === 'semgrep' ? 'Code Smell' : 'Bug'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                         <SeverityBadge
                           severity={row.severity}
                           label={row.severity === 'critical' ? 'Critical' : row.severity === 'high' ? 'Major' : 'Minor'}
                         />
                      </td>
                      <td className="px-4 py-2.5 text-[10px] font-bold text-[var(--text-secondary)] text-right">
                        {row.files.size}
                      </td>
                      <td className="px-4 py-2.5 text-[10px] font-bold text-[var(--text-primary)] text-right">
                        {row.count}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => navigate(`/scans/${scanId}/sast?rule=${encodeURIComponent(row.message)}`)}
                          className="p-2 text-[var(--text-secondary)] hover:text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 rounded-lg transition-all"
                        >
                          <ChevronRight size={16} />
                        </button>
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
