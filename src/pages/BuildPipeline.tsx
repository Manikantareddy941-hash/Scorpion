import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Hammer, CheckCircle2, XCircle, Clock, RefreshCw, GitBranch, Github, ExternalLink, ShieldCheck
} from 'lucide-react';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';

export default function BuildPipeline() {
  const { t } = useTranslation();
  const [builds, setBuilds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBuilds();
  }, []);

  const fetchBuilds = async () => {
    try {
      setLoading(true);
      const response = await databases.listDocuments(DB_ID, COLLECTIONS.BUILDS, [
        Query.orderDesc('timestamp'),
        Query.limit(50)
      ]);
      setBuilds(response.documents || []);
    } catch (err) {
      console.error("Failed to fetch builds:", err);
    } finally {
      setLoading(false);
    }
  };

  const successCount = builds.filter(b => b.status === 'success').length;
  const failureCount = builds.filter(b => b.status === 'failure').length;

  const getStatusIcon = (status: string) => {
    switch(status) {
      case 'success': return <CheckCircle2 className="w-5 h-5 text-[var(--status-success)]" />;
      case 'failure': return <XCircle className="w-5 h-5 text-[var(--status-error)]" />;
      default: return <RefreshCw className="w-5 h-5 text-[var(--accent-primary)] animate-spin" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'success': return 'border-[var(--status-success)]/30 bg-[var(--status-success)]/10 text-[var(--status-success)]';
      case 'failure': return 'border-[var(--status-error)]/30 bg-[var(--status-error)]/10 text-[var(--status-error)]';
      default: return 'border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 mb-12">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-[var(--accent-primary)] rounded-2xl flex items-center justify-center text-white shadow-xl shadow-[var(--accent-primary)]/20">
            <Hammer className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tighter uppercase italic">CI/CD Pipeline</h1>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.2em] mt-1 italic font-mono">Automated Build Tracking</p>
          </div>
        </div>
        
        <button
          onClick={fetchBuilds}
          disabled={loading}
          className="btn-premium flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="p-6 flex flex-col justify-center group hover:border-[var(--accent-primary)] transition-colors premium-card relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Github className="w-24 h-24" />
          </div>
          <p className="text-[10px] font-black text-[var(--text-primary)] uppercase tracking-widest italic mb-2 relative z-10">Total Builds</p>
          <p className="text-4xl font-black tracking-tighter italic text-[var(--accent-primary)] relative z-10">{builds.length}</p>
        </div>
        <div className="p-6 flex flex-col justify-center group hover:border-[var(--status-success)] transition-colors premium-card relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <CheckCircle2 className="w-24 h-24 text-[var(--status-success)]" />
          </div>
          <p className="text-[10px] font-black text-[var(--text-primary)] uppercase tracking-widest italic mb-2 relative z-10">Successful</p>
          <p className="text-4xl font-black tracking-tighter italic text-[var(--status-success)] relative z-10">{successCount}</p>
        </div>
        <div className="p-6 flex flex-col justify-center group hover:border-[var(--status-error)] transition-colors premium-card relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <XCircle className="w-24 h-24 text-[var(--status-error)]" />
          </div>
          <p className="text-[10px] font-black text-[var(--text-primary)] uppercase tracking-widest italic mb-2 relative z-10">Failed</p>
          <p className="text-4xl font-black tracking-tighter italic text-[var(--status-error)] relative z-10">{failureCount}</p>
        </div>
      </div>

      <div className="premium-card overflow-hidden">
        <div className="px-10 py-8 border-b border-[var(--border-subtle)] bg-white/5 dark:bg-white/10 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-black text-[var(--text-primary)] uppercase italic tracking-tight">Build History</h2>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-1 italic font-mono">GitHub Actions Workflows</p>
          </div>
        </div>

        <div className="divide-y divide-[var(--border-subtle)]">
          {loading && builds.length === 0 ? (
            <div className="p-16 flex justify-center">
              <RefreshCw className="w-8 h-8 animate-spin text-[var(--text-secondary)]" />
            </div>
          ) : builds.length === 0 ? (
            <div className="p-16 text-center text-[var(--text-secondary)] text-sm font-bold uppercase tracking-widest italic">
              No builds found. Waiting for CI/CD workflow_run webhooks.
            </div>
          ) : (
            builds.map((build) => (
              <div key={build.$id} className="p-8 hover:bg-white/5 transition-all group relative">
                {build.status === 'success' && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--status-success)]" />
                )}
                {build.status === 'failure' && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--status-error)]" />
                )}
                
                <div className="flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
                  
                  <div className="flex items-center gap-6">
                    <div className="flex-shrink-0">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${getStatusColor(build.status)}`}>
                        {getStatusIcon(build.status)}
                      </div>
                    </div>
                    
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="font-mono text-xs font-bold text-[var(--text-primary)] bg-[var(--bg-primary)] px-2 py-1 rounded border border-[var(--border-subtle)]">
                          {build.repo_name}
                        </span>
                        <span className={`flex items-center gap-1 text-[9px] font-black uppercase tracking-widest italic border px-2 py-1 rounded-full ${getStatusColor(build.status)}`}>
                          {build.status}
                        </span>
                        {build.status === 'success' && (
                          <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest italic text-[var(--accent-primary)] border border-[var(--accent-primary)]/30 px-2 py-1 rounded-full bg-[var(--accent-primary)]/10">
                            <ShieldCheck className="w-3 h-3" /> Auto-Scan Triggered
                          </span>
                        )}
                      </div>
                      
                      <h3 className="text-lg font-bold text-[var(--text-primary)] mb-1">
                        {build.workflow_name}
                      </h3>
                      
                      <div className="flex flex-wrap gap-4 text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] italic mt-2">
                        <span className="flex items-center gap-1">
                          <GitBranch className="w-3 h-3" /> Run #{build.run_number}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {new Date(build.timestamp).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {build.run_url && (
                    <a 
                      href={build.run_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg text-[10px] font-black text-[var(--text-primary)] uppercase tracking-widest italic hover:bg-[var(--bg-secondary)] hover:border-[var(--accent-primary)] transition-all"
                    >
                      View Logs <ExternalLink className="w-3 h-3" />
                    </a>
                  )}

                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
