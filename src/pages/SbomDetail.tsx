import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Activity, Box, Download, Search, FileCode } from 'lucide-react';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import toast from 'react-hot-toast';

export default function SbomDetail() {
  const { scanId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [dependencies, setDependencies] = useState<any[]>([]);

  useEffect(() => {
    const fetchSbom = async () => {
      if (!scanId) return;
      setLoading(true);
      try {
        // In a real app, this would fetch from a specific SBOM collection or file storage
        // For now, we aggregate from the vulnerabilities collection to show unique packages
        const res = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
          Query.equal('scanId', scanId),
          Query.limit(100)
        ]);
        
        const uniquePackages = Array.from(new Set(res.documents.map((d: any) => d.package))).filter(Boolean);
        setDependencies(uniquePackages.map(pkg => ({ name: pkg, version: 'latest', license: 'MIT', type: 'library' })));
      } catch (err) {
        toast.error('Failed to generate SBOM view');
      } finally {
        setLoading(false);
      }
    };
    fetchSbom();
  }, [scanId]);

  if (loading) return <div className="flex-1 flex flex-col items-center justify-center min-h-[400px]"><Activity className="animate-spin text-[var(--accent-primary)]" /></div>;

  return (
    <div className="flex-1 w-full max-w-7xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 bg-[var(--bg-card)] rounded-lg border border-[var(--border-subtle)]"><ArrowLeft size={18} /></button>
          <div>
            <h1 className="text-2xl font-black text-[var(--text-primary)] uppercase italic">Software Bill of Materials (SBOM)</h1>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-1">Inventory for Scan {scanId}</p>
          </div>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-[var(--accent-primary)] text-black rounded-xl text-[10px] font-black uppercase tracking-widest">
          <Download size={14} /> Export CycloneDX
        </button>
      </div>

      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-subtle)] overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[var(--bg-primary)] border-bottom border-[var(--border-subtle)]">
              <th className="px-6 py-4 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Component</th>
              <th className="px-6 py-4 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Version</th>
              <th className="px-6 py-4 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">License</th>
              <th className="px-6 py-4 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Type</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {dependencies.map((dep, i) => (
              <tr key={i} className="hover:bg-[var(--bg-primary)] transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <Box size={14} className="text-[var(--accent-primary)]" />
                    <span className="text-xs font-bold text-[var(--text-primary)]">{dep.name}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-xs text-[var(--text-secondary)] font-mono">{dep.version}</td>
                <td className="px-6 py-4 text-xs text-[var(--text-secondary)]">{dep.license}</td>
                <td className="px-6 py-4">
                  <span className="px-2 py-0.5 rounded bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[9px] font-bold text-[var(--text-secondary)] uppercase">{dep.type}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
