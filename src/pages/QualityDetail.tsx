import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Activity, Sparkles, CheckCircle2,
  ChevronRight
} from 'lucide-react';
import { fetchScanFindings } from '../lib/scanApi';
import { FindingsLoadError } from '../components/FindingsLoadError';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

export default function QualityDetail() {
  const { scanId } = useParams();
  const { getJWT } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  // A failed read must not render as the clean-result empty state.
  const [loadFailed, setLoadFailed] = useState(false);
  const [findings, setFindings] = useState<any[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      if (!scanId) return;
      setLoading(true);
      try {
        setFindings(await fetchScanFindings(getJWT, scanId, {
          tool: 'semgrep', severity: ['low', 'info'], limit: 200,
        }));
      } catch (err) {
        setLoadFailed(true);
        toast.error('Failed to load quality audit');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [scanId, getJWT]);

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

  if (loading) return <div className="flex-1 flex flex-col items-center justify-center min-h-[400px]"><Activity className="animate-spin text-[var(--accent-primary)]" /></div>;

  return (
    <div className="flex-1 w-full max-w-7xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => navigate(-1)} className="p-2 bg-[var(--bg-card)] rounded-lg border border-[var(--border-subtle)]"><ArrowLeft size={18} /></button>
        <div>
          <h1 className="text-2xl font-black text-[var(--text-primary)] uppercase italic tracking-tight">Code Quality & Smells</h1>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-1">Found in Scan {scanId}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {loadFailed ? (
          <FindingsLoadError />
        ) : groupedFindings.length > 0 ? (
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-subtle)] overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[var(--bg-primary)] border-b border-[var(--border-subtle)]">
                  <th className="px-6 py-4 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Issue</th>
                  <th className="px-6 py-4 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Files</th>
                  <th className="px-6 py-4 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Count</th>
                  <th className="px-6 py-4 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {groupedFindings.map((row: any, i) => (
                  <tr key={i} className="hover:bg-[var(--bg-primary)] transition-colors">
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        <Sparkles size={14} className="text-cyan-500" />
                        <span className="text-xs font-bold text-[var(--text-primary)]">{row.message}</span>
                      </div>
                    </td>
                    <td className="px-6 py-5 text-[10px] font-bold text-[var(--text-secondary)] uppercase">{row.files.size} files</td>
                    <td className="px-6 py-5 text-[10px] font-bold text-[var(--text-primary)] uppercase">{row.count} instances</td>
                    <td className="px-6 py-5 text-right">
                       <button onClick={() => navigate(`/scans/${scanId}/sast?rule=${encodeURIComponent(row.message)}`)} className="text-[var(--text-secondary)] hover:text-[var(--accent-primary)]">
                         <ChevronRight size={18} />
                       </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-20 bg-[var(--bg-card)] rounded-3xl border border-[var(--border-subtle)]">
            <CheckCircle2 size={48} className="mx-auto text-[var(--status-success)] opacity-20 mb-4" />
            <h3 className="font-black text-[var(--text-primary)] uppercase tracking-widest">No code smells detected</h3>
          </div>
        )}
      </div>
    </div>
  );
}
