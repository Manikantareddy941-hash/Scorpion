import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Sparkles, CheckCircle2,
  BarChart3, ChevronRight 
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

export default function QualityDetail() {
  const { scanId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [findings, setFindings] = useState<any[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      if (!scanId) return;
      setLoading(true);
      try {
        const res = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
          Query.equal('scan_result_id', scanId),
          Query.equal('tool', 'semgrep'),
          Query.equal('severity', ['low', 'info']),
          Query.limit(200)
        ]);
        setFindings(res.documents);
      } catch (err) {
        toast.error('Failed to load quality audit');
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
          count: 0
        };
      }
      acc[key].files.add(f.file_path);
      acc[key].count++;
      return acc;
    }, {});
    return Object.values(grouped);
  }, [findings]);

  return (
    <div className="flex-1 w-full max-w-7xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" iconOnly onClick={() => navigate(-1)}><ArrowLeft size={18} /></Button>
        <div>
          <h1 className="text-2xl font-black text-[var(--text-primary)] uppercase italic tracking-tight">Code Quality & Smells</h1>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-1">Found in Scan {scanId}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {loading ? (
          <div className="card bg-neutral-900 rounded-lg border border-neutral-800 overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-neutral-900 border-b border-neutral-800">
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Issue</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Severity</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide text-right">Files</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide text-right">Count</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60">
                <SkeletonTableRows rows={6} cols={5} />
              </tbody>
            </table>
          </div>
        ) : groupedFindings.length > 0 ? (
          <div className="card bg-neutral-900 rounded-lg border border-neutral-800 overflow-hidden shadow-sm">
            <div className="max-h-[70vh] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="sticky top-0 z-10 bg-neutral-900 border-b border-neutral-800">
                    <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Issue</th>
                    <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Severity</th>
                    <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide text-right">Files</th>
                    <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide text-right">Count</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/60">
                  {groupedFindings.map((row: any, i) => (
                    <tr key={i} className={`hover:bg-neutral-800/40 transition-colors ${i % 2 === 1 ? 'bg-white/[0.02]' : ''}`}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <Sparkles size={14} className="text-cyan-500 shrink-0" />
                          <span className="text-xs font-bold text-[var(--text-primary)]">{row.message}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5"><SeverityBadge severity={row.severity} /></td>
                      <td className="px-4 py-2.5 text-[10px] font-bold text-[var(--text-secondary)] text-right">{row.files.size}</td>
                      <td className="px-4 py-2.5 text-[10px] font-bold text-[var(--text-primary)] text-right">{row.count}</td>
                      <td className="px-4 py-2.5 text-right">
                         <button onClick={() => navigate(`/scans/${scanId}/sast?rule=${encodeURIComponent(row.message)}`)} className="text-[var(--text-secondary)] hover:text-[var(--accent-primary)]">
                           <ChevronRight size={16} />
                         </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <EmptyState icon={CheckCircle2} message="No code smells detected" />
        )}
      </div>
    </div>
  );
}
