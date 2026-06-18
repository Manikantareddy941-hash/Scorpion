import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { 
  Shield, AlertTriangle, Bug, Wind, CheckCircle2, 
  ArrowLeft, Clock, Activity, FileText, Code, 
  ExternalLink, Search, Filter, Terminal, Package
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

export default function ScaDetail() {
  const { scanId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  
  const [loading, setLoading] = useState(true);
  const [findings, setFindings] = useState<Finding[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      if (!scanId) return;
      setLoading(true);
      try {
        const findingsRes = await databases.listDocuments(
          DB_ID, 
          COLLECTIONS.VULNERABILITIES, 
          [
            Query.equal('scan_result_id', scanId),
            Query.equal('tool', 'trivy'),
            Query.startsWith('message', '[VULN]'),
            Query.limit(100)
          ]
        );
        
        setFindings(findingsRes.documents as any);
      } catch (err: any) {
        console.error('[ScaDetail] Error:', err);
        toast.error('Failed to load SCA findings');
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
            <h1 className="text-2xl font-black text-[var(--text-primary)] uppercase italic">Software Composition Analysis (SCA)</h1>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-1">Dependency Vulnerability Audit</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {findings.map((finding) => (
          <div key={finding.$id} className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-subtle)] p-5 hover:border-[var(--accent-primary)]/30 transition-all">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] flex items-center justify-center"><Package size={20} /></div>
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">{finding.package || (finding.message.match(/\[(.*?)\]/)?.[1] || 'Unknown Package')}</h3>
                  <p className="text-[10px] font-black uppercase tracking-widest mt-1" style={{ color: finding.severity.toLowerCase() === 'critical' ? '#ef4444' : '#f97316' }}>
                    {finding.severity} · {finding.tool}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <span className="px-3 py-1 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-full text-[10px] font-bold text-[var(--text-primary)]">
                  {finding.version || 'v0.0.0'}
                </span>
              </div>
            </div>
            <p className="mt-4 text-xs text-[var(--text-secondary)] leading-relaxed">{finding.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
