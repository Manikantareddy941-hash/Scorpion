import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  GitCommit, Activity, ShieldAlert, GitBranch, RefreshCw, FileCode2, Clock, User
} from 'lucide-react';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';

export default function CodeActivity() {
  const { t } = useTranslation();
  const [commits, setCommits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCommits();
  }, []);

  const fetchCommits = async () => {
    try {
      setLoading(true);
      const response = await databases.listDocuments(DB_ID, COLLECTIONS.COMMITS, [
        Query.orderDesc('timestamp'),
        Query.limit(50)
      ]);
      setCommits(response.documents || []);
    } catch (err) {
      console.error("Failed to fetch commits:", err);
    } finally {
      setLoading(false);
    }
  };

  const sensitiveCount = commits.filter(c => c.is_sensitive).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 mb-12">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-[var(--accent-primary)] rounded-2xl flex items-center justify-center text-white shadow-xl shadow-[var(--accent-primary)]/20">
            <GitCommit className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tighter uppercase italic">Code Activity</h1>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.2em] mt-1 italic font-mono">Real-time Commit Stream</p>
          </div>
        </div>
        
        <button
          onClick={fetchCommits}
          disabled={loading}
          className="btn-premium flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="p-6 flex flex-col justify-center group hover:border-[var(--accent-primary)] transition-colors premium-card relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Activity className="w-24 h-24" />
          </div>
          <p className="text-[10px] font-black text-[var(--text-primary)] uppercase tracking-widest italic mb-2 relative z-10">Total Commits</p>
          <p className="text-4xl font-black tracking-tighter italic text-[var(--accent-primary)] relative z-10">{commits.length}</p>
        </div>
        <div className="p-6 flex flex-col justify-center group hover:border-[var(--status-error)] transition-colors premium-card relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <ShieldAlert className="w-24 h-24 text-[var(--status-error)]" />
          </div>
          <p className="text-[10px] font-black text-[var(--text-primary)] uppercase tracking-widest italic mb-2 relative z-10">Sensitive Touches</p>
          <p className="text-4xl font-black tracking-tighter italic text-[var(--status-error)] relative z-10">{sensitiveCount}</p>
        </div>
        <div className="p-6 flex flex-col justify-center group hover:border-[var(--status-success)] transition-colors premium-card relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <GitBranch className="w-24 h-24 text-[var(--status-success)]" />
          </div>
          <p className="text-[10px] font-black text-[var(--text-primary)] uppercase tracking-widest italic mb-2 relative z-10">Active Repos</p>
          <p className="text-4xl font-black tracking-tighter italic text-[var(--status-success)] relative z-10">{new Set(commits.map(c => c.repo_id)).size}</p>
        </div>
      </div>

      <div className="premium-card overflow-hidden">
        <div className="px-10 py-8 border-b border-[var(--border-subtle)] bg-white/5 dark:bg-white/10">
          <h2 className="text-xl font-black text-[var(--text-primary)] uppercase italic tracking-tight">Commit Stream</h2>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-1 italic font-mono">Monitored Pushes</p>
        </div>

        <div className="divide-y divide-[var(--border-subtle)]">
          {loading && commits.length === 0 ? (
            <div className="p-16 flex justify-center">
              <RefreshCw className="w-8 h-8 animate-spin text-[var(--text-secondary)]" />
            </div>
          ) : commits.length === 0 ? (
            <div className="p-16 text-center text-[var(--text-secondary)] text-sm font-bold uppercase tracking-widest italic">
              No commits found. Waiting for webhook pushes.
            </div>
          ) : (
            commits.map((commit) => (
              <div key={commit.$id} className="p-8 hover:bg-white/5 transition-all group relative">
                {commit.is_sensitive && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--status-error)]" />
                )}
                
                <div className="flex flex-col md:flex-row gap-6">
                  <div className="flex-shrink-0">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center border
                      ${commit.is_sensitive 
                        ? 'bg-[var(--status-error)]/10 border-[var(--status-error)]/30 text-[var(--status-error)]' 
                        : 'bg-[var(--accent-primary)]/10 border-[var(--accent-primary)]/30 text-[var(--accent-primary)]'}`}
                    >
                      <GitCommit className="w-6 h-6" />
                    </div>
                  </div>
                  
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="font-mono text-xs font-bold text-[var(--accent-primary)] bg-[var(--accent-primary)]/10 px-2 py-1 rounded border border-[var(--accent-primary)]/20">
                        {commit.commit_hash.substring(0, 7)}
                      </span>
                      {commit.is_sensitive && (
                        <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest italic text-[var(--status-error)] border border-[var(--status-error)]/30 px-2 py-1 rounded-full bg-[var(--status-error)]/10">
                          <ShieldAlert className="w-3 h-3" /> Sensitive Touch
                        </span>
                      )}
                    </div>
                    
                    <h3 className="text-lg font-bold text-[var(--text-primary)] mb-4">
                      {commit.message}
                    </h3>
                    
                    <div className="flex flex-wrap gap-6 text-[11px] font-bold uppercase tracking-widest text-[var(--text-secondary)] italic">
                      <span className="flex items-center gap-2">
                        <User className="w-3 h-3" /> {commit.author}
                      </span>
                      <span className="flex items-center gap-2">
                        <Clock className="w-3 h-3" /> {new Date(commit.timestamp).toLocaleString()}
                      </span>
                      <span className="flex items-center gap-2">
                        <FileCode2 className="w-3 h-3" /> {commit.files_changed?.length || 0} Files
                      </span>
                    </div>

                    {commit.files_changed && commit.files_changed.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {commit.files_changed.slice(0, 5).map((file: string, i: number) => {
                          const isSensitiveFile = ['.env', 'password', 'secret', 'key.pem', 'credentials', 'config.json', 'token'].some(p => file.toLowerCase().includes(p));
                          return (
                            <span key={i} className={`text-[10px] px-2 py-1 rounded font-mono border
                              ${isSensitiveFile ? 'text-[var(--status-error)] border-[var(--status-error)]/30 bg-[var(--status-error)]/5' : 'text-[var(--text-secondary)] border-[var(--border-subtle)] bg-[var(--bg-primary)]'}
                            `}>
                              {file}
                            </span>
                          );
                        })}
                        {commit.files_changed.length > 5 && (
                          <span className="text-[10px] px-2 py-1 rounded font-mono border border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--text-secondary)]">
                            +{commit.files_changed.length - 5} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
