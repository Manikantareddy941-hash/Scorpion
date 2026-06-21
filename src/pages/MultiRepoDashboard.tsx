import { useEffect, useState } from 'react';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import SBOMExportButton from '../components/SBOMExportButton';
import toast from 'react-hot-toast';

interface ScanRecord {
  $id: string;
  repoId: string;
  repoName?: string;
  security_score: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  $createdAt: string;
}

// Maps a raw Appwrite scan document (which stores counts at the top level and
// the security score inside a JSON `details` string) into the flat shape this
// view renders.
const mapScan = (doc: any, repoName?: string): ScanRecord => {
  let details: any = {};
  try {
    details = typeof doc.details === 'string' ? JSON.parse(doc.details) : (doc.details || {});
  } catch {
    details = {};
  }
  return {
    $id: doc.$id,
    repoId: doc.repo_id,
    repoName,
    security_score: Number(details.security_score ?? doc.security_score ?? 0),
    critical_count: Number(doc.criticalCount ?? details.critical_count ?? 0),
    high_count: Number(doc.highCount ?? details.high_count ?? 0),
    medium_count: Number(doc.mediumCount ?? details.medium_count ?? 0),
    low_count: Number(doc.lowCount ?? details.low_count ?? 0),
    $createdAt: doc.$createdAt,
  };
};

export default function MultiRepoDashboard() {
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState<string | null>(null);
  const { user, getJWT } = useAuth();

  // Fetch completed scans for the current user's repositories only.
  const fetchScans = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const reposRes = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
        Query.equal('user_id', user.$id),
        Query.limit(200),
      ]);
      const repoNameById: Record<string, string> = {};
      reposRes.documents.forEach((r: any) => { repoNameById[r.$id] = r.name; });
      const repoIds = reposRes.documents.map((r: any) => r.$id);

      if (repoIds.length === 0) {
        setScans([]);
        return;
      }

      const res = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
        Query.equal('repo_id', repoIds),
        Query.equal('status', 'completed'),
        Query.orderDesc('$createdAt'),
        Query.limit(200),
      ]);
      const docs = res.documents.map((d: any) => mapScan(d, repoNameById[d.repo_id]));
      setScans(docs);
      if (docs.length && !selectedRepoId) {
        // default to the repo with the worst score
        const worst = docs.reduce((a, b) => (a.security_score < b.security_score ? a : b));
        setSelectedRepoId(worst.repoId);
      }
    } catch (e) {
      console.error('Failed to fetch scans', e);
      toast.error('Failed to load repository scans');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScans();
  }, [user]);

  // Compute summary metrics
  const summary = scans.reduce(
    (acc, cur) => {
      acc.totalScore += cur.security_score;
      acc.totalCritical += cur.critical_count;
      acc.totalHigh += cur.high_count;
      acc.totalMedium += cur.medium_count;
      acc.totalLow += cur.low_count;
      return acc;
    },
    {
      totalScore: 0,
      totalCritical: 0,
      totalHigh: 0,
      totalMedium: 0,
      totalLow: 0,
    }
  );
  const repoCount = scans.length;
  const avgScore = repoCount ? Math.round(summary.totalScore / repoCount) : 0;

  // Group scans by repo (latest scan per repo)
  const latestByRepo: Record<string, ScanRecord> = {};
  scans.forEach(scan => {
    const existing = latestByRepo[scan.repoId];
    if (!existing || new Date(scan.$createdAt) > new Date(existing.$createdAt)) {
      latestByRepo[scan.repoId] = scan;
    }
  });
  const repoList = Object.values(latestByRepo).sort((a, b) => a.security_score - b.security_score);

  const selectedRepo = selectedRepoId ? latestByRepo[selectedRepoId] : null;

  const handleReScan = async (repoId: string) => {
    setRescanning(repoId);
    try {
      const token = await getJWT();
      const res = await fetch('/api/scan/manual/trigger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ repo_id: repoId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to trigger scan');
      toast.success('Re-scan triggered');
      await fetchScans();
    } catch (err: any) {
      toast.error(err.message || 'Failed to trigger re-scan');
    } finally {
      setRescanning(null);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] p-8 text-[var(--text-primary)] transition-colors duration-300">
      <h1 className="text-3xl font-black uppercase mb-6">Repository Governance Dashboard</h1>
      {loading ? (
        <div className="flex items-center gap-2 text-[var(--text-secondary)]">
          <Loader2 className="animate-spin w-5 h-5" /> Loading scans…
        </div>
      ) : (
        <>
          {/* Summary Bar */}
          <div className="premium-card p-6 mb-8 flex flex-wrap gap-6 items-center justify-between">
            <div className="text-sm font-black uppercase">Avg Score: {avgScore}</div>
            <div className="text-sm font-black uppercase">Critical: {summary.totalCritical}</div>
            <div className="text-sm font-black uppercase">High: {summary.totalHigh}</div>
            <div className="text-sm font-black uppercase">Medium: {summary.totalMedium}</div>
            <div className="text-sm font-black uppercase">Low: {summary.totalLow}</div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Repo List */}
            <div className="bg-[var(--bg-secondary)] rounded-xl p-4 overflow-y-auto max-h-[70vh]">
              <h2 className="text-lg font-black uppercase mb-4">Repositories ({repoList.length})</h2>
              {repoList.map(repo => (
                <button
                  key={repo.repoId}
                  onClick={() => setSelectedRepoId(repo.repoId)}
                  className={`w-full text-left p-2 rounded-md mb-2 flex justify-between items-center 
                    ${repo.repoId === selectedRepoId ? 'bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]' : 'hover:bg-[var(--bg-secondary)]'}
                  `}
                >
                  <span className="font-medium">{repo.repoName || repo.repoId}</span>
                  <span className="text-xs font-black uppercase">Score: {repo.security_score}</span>
                </button>
              ))}
            </div>

            {/* Detail Panel */}
            <div className="md:col-span-2 bg-[var(--bg-secondary)] rounded-xl p-6">
              {selectedRepo ? (
                <>
                  <h2 className="text-2xl font-black uppercase mb-4">{selectedRepo.repoName || selectedRepo.repoId}</h2>
                  <div className="flex items-center gap-4 mb-4">
                    <span className="text-sm font-black uppercase">Score: {selectedRepo.security_score}</span>
                    <button
                      onClick={() => handleReScan(selectedRepo.repoId)}
                      disabled={rescanning === selectedRepo.repoId}
                      className="flex items-center gap-1 px-3 py-1 bg-[var(--accent-primary)] text-white rounded-md text-xs disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${rescanning === selectedRepo.repoId ? 'animate-spin' : ''}`} /> {rescanning === selectedRepo.repoId ? 'Scanning…' : 'Re‑scan'}
                    </button>
                    <SBOMExportButton repoId={selectedRepo.repoId} repoName={selectedRepo.repoName || selectedRepo.repoId} />
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm font-black uppercase">
                    <div>Critical: {selectedRepo.critical_count}</div>
                    <div>High: {selectedRepo.high_count}</div>
                    <div>Medium: {selectedRepo.medium_count}</div>
                    <div>Low: {selectedRepo.low_count}</div>
                  </div>
                  <p className="mt-4 text-[var(--text-secondary)]">Last scanned: {new Date(selectedRepo.$createdAt).toLocaleString()}</p>
                </>
              ) : (
                <p className="text-[var(--text-secondary)]">Select a repository to view details.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
