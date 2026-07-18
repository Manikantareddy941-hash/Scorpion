import { useState } from 'react';
import { Download, ChevronDown, Loader2, FileText, FileSpreadsheet } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { slaHoursLeft, slaDeadline, daysOverdue } from '../lib/sla';
import {
  exportPosturePdf, exportPostureCsv,
  type PostureSnapshot, type SlaBreachRow,
} from '../lib/exportPosture';

interface Props {
  // Built lazily at click time so the export reflects the latest dashboard state.
  getSnapshot: () => PostureSnapshot;
}

// Lazy-fetch overdue findings only when CSV is requested. Returns null on
// failure so the CSV degrades to a summary with a note.
//
// Both reads were direct Appwrite queries with no ownership filter: the CSV
// this produces was built from every open finding and every repository in the
// collection. An export is the worst place for that — it leaves the app as a
// file, so a leak here outlives the session that caused it.
async function fetchSlaBreachRows(token: string | null): Promise<SlaBreachRow[] | null> {
  try {
    const authed = { headers: { Authorization: `Bearer ${token}` } };
    const [vulnRes, repoRes] = await Promise.all([
      fetch('/api/issues?status=open&limit=200', authed),
      fetch('/api/repos', authed),
    ]);
    if (!vulnRes.ok || !repoRes.ok) {
      throw new Error(`export fetch failed: issues ${vulnRes.status}, repos ${repoRes.status}`);
    }

    const vulnDocs: any[] = (await vulnRes.json())?.documents ?? [];
    const repoDocs = await repoRes.json();

    const repoName = new Map<string, string>(
      (Array.isArray(repoDocs) ? repoDocs : []).map((r: any) => [
        r.$id,
        r.name || r.url?.split('/').pop()?.replace('.git', '') || r.$id,
      ]),
    );

    const now = Date.now();
    return vulnDocs
      .filter((d: any) => d.$createdAt && slaHoursLeft(d.$createdAt, d.severity, now) < 0)
      .map((d: any): SlaBreachRow => ({
        id: d.$id,
        severity: String(d.severity || '').toUpperCase(),
        asset: repoName.get(d.repo_id) || d.repo_id || 'unknown',
        deadline: slaDeadline(d.$createdAt, d.severity).toISOString(),
        daysOverdue: daysOverdue(d.$createdAt, d.severity, now),
        status: d.status || d.resolution_status || 'open',
      }))
      .sort((a, b) => b.daysOverdue - a.daysOverdue);
  } catch (err) {
    console.error('SLA breach fetch failed:', err);
    return null; // signals degrade-to-summary
  }
}

export default function PostureExportButton({ getSnapshot }: Props) {
  const { getJWT } = useAuth();
  const [loading, setLoading] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const handlePdf = () => {
    setShowMenu(false);
    try {
      exportPosturePdf(getSnapshot());
      toast.success('Posture PDF exported');
    } catch (err: any) {
      console.error('PDF export failed:', err);
      toast.error('Failed to export PDF');
    }
  };

  const handleCsv = async () => {
    setShowMenu(false);
    setLoading(true);
    try {
      const slaRows = await fetchSlaBreachRows(await getJWT());
      exportPostureCsv(getSnapshot(), slaRows);
      toast.success(slaRows === null ? 'CSV exported (summary — detail fetch failed)' : 'Posture CSV exported');
    } catch (err: any) {
      console.error('CSV export failed:', err);
      toast.error('Failed to export CSV');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative inline-flex h-10">
      <button
        type="button"
        onClick={handlePdf}
        disabled={loading}
        className="flex items-center gap-2 px-4 h-full text-[10px] font-black uppercase tracking-widest rounded-l-xl hover:opacity-90 disabled:opacity-50 transition-all border-r border-white/20"
        style={{ background: 'var(--accent-primary)', color: 'var(--text-on-accent)' }}
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        Export Posture
      </button>
      <button
        type="button"
        onClick={() => setShowMenu((v) => !v)}
        disabled={loading}
        aria-label="Export format menu"
        className="px-2 h-full rounded-r-xl hover:opacity-90 disabled:opacity-50 transition-all"
        style={{ background: 'var(--accent-primary)', color: 'var(--text-on-accent)' }}
      >
        <ChevronDown className={`w-4 h-4 transition-transform ${showMenu ? 'rotate-180' : ''}`} />
      </button>

      {showMenu && (
        <div className="absolute top-full right-0 mt-2 w-52 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl shadow-2xl z-[100] overflow-hidden animate-in fade-in slide-in-from-top-2">
          <button
            type="button"
            onClick={handlePdf}
            className="w-full flex items-center gap-3 px-4 py-3 text-[10px] font-bold text-[var(--text-primary)] hover:bg-[var(--accent-primary)]/10 transition-colors border-b border-[var(--border-subtle)]"
          >
            <FileText className="w-4 h-4 text-rose-400" />
            PDF — Executive Snapshot
          </button>
          <button
            type="button"
            onClick={handleCsv}
            className="w-full flex items-center gap-3 px-4 py-3 text-[10px] font-bold text-[var(--text-primary)] hover:bg-[var(--accent-primary)]/10 transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            CSV — SLA Breach List
          </button>
        </div>
      )}
    </div>
  );
}
