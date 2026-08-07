import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle2,
  ArrowLeft, Activity, Lock, Search
} from 'lucide-react';
import { fetchScan, fetchScanFindings } from '../lib/scanApi';
import { FindingsLoadError } from '../components/FindingsLoadError';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

interface Finding {
  $id: string;
  message: string;
  severity: string;
  file_path: string;
  line_number: number;
  package?: string;
  version?: string;
  tool: string;
  detected_at: string;
}

export default function SecretsDetail() {
  const { scanId } = useParams();
  const { getJWT } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  // A failed read must not render as the clean-result empty state.
  const [loadFailed, setLoadFailed] = useState(false);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [, setScan] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSeverity, setActiveSeverity] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!scanId) return;
      setLoading(true);
      try {
        const [scanDoc, findingDocs] = await Promise.all([
          fetchScan(getJWT, scanId),
          fetchScanFindings(getJWT, scanId, { tool: 'gitleaks', limit: 100 }),
        ]);
        setScan(scanDoc);
        setFindings(findingDocs as any);
      } catch (err: any) {
        console.error('[SecretsDetail] Error fetching data:', err);
        setLoadFailed(true);
        toast.error('Failed to load secrets findings');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [scanId, getJWT]);

  const filteredFindings = findings.filter(f => {
    const matchesSearch = f.message?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         f.file_path?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSeverity = !activeSeverity || f.severity.toLowerCase() === activeSeverity.toLowerCase();
    return matchesSearch && matchesSeverity;
  });

  if (loading) return <div className="flex-1 flex flex-col items-center justify-center min-h-[400px]"><Activity className="animate-spin text-[var(--accent-primary)]" /></div>;

  return (
    <div className="flex-1 w-full max-w-7xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 bg-[var(--bg-card)] rounded-lg border border-[var(--border-subtle)]"><ArrowLeft size={18} /></button>
          <div>
            <h1 className="text-2xl font-black text-[var(--text-primary)] uppercase italic">Secrets Detection Audit</h1>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-1">Scan ID: {scanId}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by message or file path..."
            className="w-full pl-9 pr-3 py-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-primary)]"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((s) => (
            <button
              key={s}
              onClick={() => setActiveSeverity(activeSeverity === s ? null : s)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all ${
                activeSeverity === s
                  ? 'border-[var(--accent-primary)] text-[var(--accent-primary)] bg-[var(--accent-primary)]/10'
                  : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {loadFailed ? (
          <FindingsLoadError />
        ) : filteredFindings.length > 0 ? (
          filteredFindings.map((finding) => (
            <div key={finding.$id} className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-subtle)] p-6">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center">
                    <Lock size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-[var(--text-primary)] uppercase">
                       {finding.message.split('\n')[0].substring(0, 80)}...
                    </h3>
                    <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider">{finding.severity}</p>
                  </div>
                </div>
                <span className="text-[9px] font-black text-[var(--text-secondary)] bg-[var(--bg-primary)] px-2 py-1 rounded-md">LINE {finding.line_number}</span>
              </div>
              <div className="bg-[var(--bg-primary)] p-4 rounded-xl border border-[var(--border-subtle)] mb-4">
                <p className="text-xs font-mono text-[var(--text-primary)] truncate">{finding.file_path}</p>
              </div>
              <div className="bg-[#0d0d0d] rounded-xl p-4 border border-[#1a1a1a] font-mono text-[11px] text-red-400 break-all">
                {finding.message}
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-20 bg-[var(--bg-card)] rounded-3xl border border-[var(--border-subtle)]">
            <CheckCircle2 size={48} className="mx-auto text-[var(--status-success)] opacity-20 mb-4" />
            <h3 className="font-black text-[var(--text-primary)] uppercase">No leaked secrets detected</h3>
          </div>
        )}
      </div>
    </div>
  );
}
