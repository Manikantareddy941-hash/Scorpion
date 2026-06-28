import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Activity, Box, Download, ChevronRight } from 'lucide-react';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

interface SbomComponent {
  name: string;
  version: string;
  fixVersion?: string;
  highestSeverity?: string;
  cveId?: string;
}

export default function SbomDetail() {
  const { scanId } = useParams();
  const navigate = useNavigate();
  const { getJWT } = useAuth();
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [repoId, setRepoId] = useState<string | null>(null);
  const [components, setComponents] = useState<SbomComponent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSbom = async () => {
      if (!scanId) return;
      setLoading(true);
      setError(null);
      try {
        const scan = await databases.getDocument(DB_ID, COLLECTIONS.SCANS, scanId);
        const resolvedRepoId = scan.repo_id;
        setRepoId(resolvedRepoId);

        const token = await getJWT();
        const res = await fetch(`/api/sbom/${resolvedRepoId}?format=json`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to generate SBOM');
        }
        const sbom = await res.json();
        setComponents(
          (sbom.components || []).map((c: any) => {
            const props: Record<string, string> = {};
            (c.properties || []).forEach((p: any) => { props[p.name] = p.value; });
            return {
              name: c.name,
              version: c.version,
              fixVersion: c.fixVersion,
              highestSeverity: props['risk:highestSeverity'],
              cveId: (c.vulnerabilities || [])[0]?.id,
            };
          })
        );
      } catch (err: any) {
        setError(err.message || 'Failed to generate SBOM view');
        toast.error(err.message || 'Failed to generate SBOM view');
      } finally {
        setLoading(false);
      }
    };
    fetchSbom();
  }, [scanId, getJWT]);

  const handleExport = async (format: 'json' | 'csv') => {
    if (!repoId) return;
    setExporting(true);
    try {
      const token = await getJWT();
      const res = await fetch(`/api/sbom/${repoId}?format=${format}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to export SBOM');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sbom_${repoId}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      toast.error(err.message || 'Failed to export SBOM');
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <div className="flex-1 flex flex-col items-center justify-center min-h-[400px]"><Activity className="animate-spin text-[var(--accent-primary)]" /></div>;

  return (
    <div className="flex-1 w-full max-w-7xl mx-auto p-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 bg-[var(--bg-card)] rounded-lg border border-[var(--border-subtle)]"><ArrowLeft size={18} /></button>
          <div>
            <nav className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-2">
              <span>Inventory</span>
              <ChevronRight size={12} />
              <span className="text-[var(--accent-primary)]">SBOM List</span>
            </nav>
            <h1 className="text-2xl font-black text-[var(--text-primary)] uppercase italic">Software Bill of Materials (SBOM)</h1>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-1">Reflects the most recent completed scan for this repository</p>
          </div>
        </div>
        <button
          onClick={() => handleExport('json')}
          disabled={exporting || !repoId}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--accent-primary)] text-black rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
        >
          <Download size={14} /> {exporting ? 'Exporting…' : 'Export CycloneDX'}
        </button>
      </div>

      {error ? (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-subtle)] p-10 text-center">
          <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest">{error}</p>
        </div>
      ) : components.length === 0 ? (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-subtle)] p-10 text-center">
          <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest">No components found for this scan</p>
        </div>
      ) : (
        <>
          <div className="bg-[var(--bg-card)] rounded-2xl p-4 border border-[var(--accent-primary)]/10 flex items-center justify-between mb-6 max-w-xs">
            <div>
              <p className="text-[10px] font-black text-[var(--accent-primary)]/80 uppercase tracking-widest">Total Components</p>
              <h3 className="text-2xl font-black text-[var(--accent-primary)]">{components.length.toLocaleString()}</h3>
            </div>
            <div className="w-10 h-10 rounded-full bg-[var(--accent-primary)]/10 flex items-center justify-center">
              <Box size={18} className="text-[var(--accent-primary)]" />
            </div>
          </div>
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-subtle)] overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[var(--bg-primary)] border-bottom border-[var(--border-subtle)]">
                  <th className="px-6 py-4 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Component</th>
                  <th className="px-6 py-4 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Version</th>
                  <th className="px-6 py-4 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Fix Version</th>
                  <th className="px-6 py-4 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Highest Severity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {components.map((dep, i) => (
                  <tr key={i} className="hover:bg-[var(--bg-primary)] transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Box size={14} className="text-[var(--accent-primary)]" />
                        <span className="text-xs font-bold text-[var(--text-primary)]">{dep.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-[var(--text-secondary)] font-mono">{dep.version}</td>
                    <td className="px-6 py-4 text-xs font-mono">{dep.fixVersion ? <span className="text-[var(--accent-primary)] font-bold">{dep.fixVersion}</span> : <span className="text-[var(--text-secondary)]/40">—</span>}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                          dep.highestSeverity ? 'bg-[var(--status-error)]/10 text-[var(--status-error)] border border-[var(--status-error)]/20' : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)]'
                        }`}>{dep.highestSeverity || 'NONE'}</span>
                        {dep.cveId && <span className="text-[10px] text-[var(--text-secondary)] font-medium truncate max-w-[180px]">{dep.cveId}</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
