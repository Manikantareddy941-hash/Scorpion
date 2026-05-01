import { useEffect, useState } from 'react';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import SBOMExportButton from '../components/SBOMExportButton';

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

export default function MultiRepoDashboard() {
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const { user } = useAuth();

  // Fetch all scan documents
  const fetchScans = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await databases.listDocuments(
        DB_ID,
        COLLECTIONS.SCANS,
        []
      );
      const docs = res.documents as ScanRecord[];
      setScans(docs);
      if (docs.length && !selectedRepoId) {
        // default to the repo with the worst score
        const worst = docs.reduce((a, b) => (a.security_score < b.security_score ? a : b));
        setSelectedRepoId(worst.repoId);
      }
    } catch (e) {
      console.error('Failed to fetch scans', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScans();
    // Optional realtime subscription could be added here later
  }, []);

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
    // Placeholder – would trigger backend scan creation
    console.log('Re-scan requested for', repoId);
    // For now just refresh the list
    await fetchScans();
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
                      className="flex items-center gap-1 px-3 py-1 bg-[var(--accent-primary)] text-white rounded-md text-xs"
                    >
                      <RefreshCw className="w-3 h-3" /> Re‑scan
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
