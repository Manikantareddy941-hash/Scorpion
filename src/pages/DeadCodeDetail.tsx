import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Activity, Trash2, CheckCircle2 } from 'lucide-react';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import toast from 'react-hot-toast';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';

export default function DeadCodeDetail() {
  const { scanId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [findings, setFindings] = useState<any[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      if (!scanId) return;
      setLoading(true);
      try {
        const res = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
          Query.equal('scanId', scanId),
          Query.limit(100)
        ]);
        const docs = res.documents.filter((d: any) => d.message?.toLowerCase().includes('unused') || d.title?.toLowerCase().includes('dead'));
        setFindings(docs);
      } catch (err) {
        toast.error('Failed to load dead code analysis');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [scanId]);

  if (loading) return <div className="flex-1 flex flex-col items-center justify-center min-h-[400px]"><Activity className="animate-spin text-[var(--accent-primary)]" /></div>;

  return (
    <div className="flex-1 w-full max-w-7xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" iconOnly onClick={() => navigate(-1)}><ArrowLeft size={18} /></Button>
        <div>
          <h1 className="text-2xl font-black text-[var(--text-primary)] uppercase italic">Dead Code Analysis</h1>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-1">Unused Variables & Functions for {scanId}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {findings.length > 0 ? findings.map((f, i) => (
          <div key={i} className="card bg-neutral-900 rounded-lg border border-neutral-800 p-6">
             <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gray-500/10 text-gray-500 flex items-center justify-center"><Trash2 size={20} /></div>
                <h3 className="text-sm font-black text-[var(--text-primary)] uppercase">Unreachable/Unused Code Detected</h3>
             </div>
             <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{f.message}</p>
          </div>
        )) : (
          <EmptyState icon={CheckCircle2} message="No dead code detected in active branches" />
        )}
      </div>
    </div>
  );
}
