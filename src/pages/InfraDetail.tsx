import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { 
  Shield, AlertTriangle, Bug, Wind, CheckCircle2, 
  ArrowLeft, Clock, Activity, FileText, Code, 
  ExternalLink, Search, Filter, Terminal, Globe
} from 'lucide-react';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { useTranslation } from 'react-i18next';
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

export default function InfraDetail() {
  const { scanId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  
  const [loading, setLoading] = useState(true);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [scan, setScan] = useState<any>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!scanId) return;
      setLoading(true);
      try {
        const scanDoc = await databases.getDocument(DB_ID, COLLECTIONS.SCANS, scanId);
        setScan(scanDoc);

        const findingsRes = await databases.listDocuments(
          DB_ID, 
          COLLECTIONS.VULNERABILITIES, 
          [
            Query.equal('scan_result_id', scanId),
            Query.equal('tool', 'trivy'),
            Query.startsWith('message', '[CONFIG]'),
            Query.limit(100)
          ]
        );
        
        setFindings(findingsRes.documents as any);
      } catch (err: any) {
        console.error('[InfraDetail] Error:', err);
        toast.error('Failed to load infrastructure findings');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [scanId]);

  if (loading) return <div className="flex-1 flex flex-col items-center justify-center min-h-[400px]"><Activity className="animate-spin text-[var(--accent-primary)]" /></div>;

  return (
    <div className="flex-1 w-full max-w-7xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 bg-[var(--bg-card)] rounded-lg border border-[var(--border-subtle)]"><ArrowLeft size={18} /></button>
          <div>
            <h1 className="text-2xl font-black text-[var(--text-primary)] uppercase italic">Infrastructure & IaC Security</h1>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-1">Scan ID: {scanId}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {findings.length > 0 ? (
          findings.map((finding) => (
            <div key={finding.$id} className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-subtle)] p-6">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center"><Globe size={20} /></div>
                  <div>
                    <h3 className="text-sm font-black text-[var(--text-primary)] uppercase">
                      {finding.message.split(':').pop()?.trim().substring(0, 80) || 'IaC Misconfiguration'}
                    </h3>
                    <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">{finding.severity}</p>
                  </div>
                </div>
              </div>
              <div className="bg-[var(--bg-primary)] p-4 rounded-xl border border-[var(--border-subtle)] mb-4">
                <p className="text-xs font-mono text-[var(--text-primary)] truncate">{finding.file_path}</p>
              </div>
              <div className="bg-[#0d0d0d] rounded-xl p-4 border border-[#1a1a1a] font-mono text-[11px] text-blue-300">
                {finding.message}
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-20 bg-[var(--bg-card)] rounded-3xl border border-[var(--border-subtle)]">
            <CheckCircle2 size={48} className="mx-auto text-[var(--status-success)] opacity-20 mb-4" />
            <h3 className="font-black text-[var(--text-primary)] uppercase">No infrastructure misconfigurations found</h3>
          </div>
        )}
      </div>
    </div>
  );
}
