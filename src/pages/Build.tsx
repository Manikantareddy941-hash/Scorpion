import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Hammer, CheckCircle2, XCircle, Clock, RefreshCw, Terminal, Box, Rocket, ChevronDown, ChevronUp } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Build() {
  const { getJWT } = useAuth();
  const [builds, setBuilds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedBuildId, setExpandedBuildId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [repoFilter, setRepoFilter] = useState<string>('all');

  const fetchBuilds = async () => {
    try {
      setLoading(true);
      const token = await getJWT();
      const res = await fetch('/api/builds', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setBuilds(data.documents || []);
      }
    } catch (err) {
      console.error('Failed to fetch builds:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBuilds();
    const interval = setInterval(() => {
      fetchBuilds();
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const triggerBuild = async () => {
    const repoId = window.prompt("Enter Repository ID:");
    const branch = window.prompt("Enter Branch (e.g., main):", "main");
    
    if (repoId && branch) {
      try {
        const token = await getJWT();
        toast.loading("Triggering build...", { id: 'build' });
        const res = await fetch('/api/builds/trigger', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ repoId, branch })
        });
        
        if (res.ok) {
          toast.success("Build triggered successfully", { id: 'build' });
          fetchBuilds();
        } else {
          toast.error("Failed to trigger build", { id: 'build' });
        }
      } catch (err) {
        toast.error("Error triggering build", { id: 'build' });
      }
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle2 className="w-5 h-5 text-[var(--status-success)]" />;
      case 'failed': return <XCircle className="w-5 h-5 text-[var(--status-error)]" />;
      case 'running': return <RefreshCw className="w-5 h-5 text-[var(--status-warning)] animate-spin" />;
      default: return <Clock className="w-5 h-5 text-[var(--text-secondary)]" />;
    }
  };

  const filteredBuilds = builds.filter(b => {
    if (statusFilter !== 'all' && b.status !== statusFilter) return false;
    if (repoFilter !== 'all' && b.repoId !== repoFilter) return false;
    return true;
  });

  const uniqueRepos = Array.from(new Set(builds.map(b => b.repoId).filter(Boolean)));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 mb-8">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-[var(--accent-primary)] rounded-2xl flex items-center justify-center text-white shadow-xl shadow-[var(--accent-primary)]/20">
            <Hammer className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tighter uppercase italic">Build Pipelines</h1>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.2em] mt-1 italic font-mono">Automated CI Execution</p>
          </div>
        </div>
        
        <div className="flex gap-4">
          <select 
            value={statusFilter} 
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg px-4 py-2 text-sm text-[var(--text-primary)]"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
          </select>
          <select 
            value={repoFilter} 
            onChange={(e) => setRepoFilter(e.target.value)}
            className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg px-4 py-2 text-sm text-[var(--text-primary)]"
          >
            <option value="all">All Repositories</option>
            {uniqueRepos.map(repo => (
              <option key={repo} value={repo}>{repo}</option>
            ))}
          </select>
          <button onClick={triggerBuild} className="btn-premium flex items-center gap-2">
            <Hammer className="w-4 h-4" /> Trigger Build
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {filteredBuilds.map(build => (
          <div key={build.$id} className="premium-card overflow-hidden">
            <div 
              className="p-6 flex items-center justify-between cursor-pointer hover:bg-[var(--bg-primary)]/30 transition-colors"
              onClick={() => setExpandedBuildId(expandedBuildId === build.$id ? null : build.$id)}
            >
              <div className="flex items-center gap-6">
                {getStatusIcon(build.status)}
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-bold text-[var(--text-primary)]">{build.repoId}</span>
                    <span className="text-xs text-[var(--text-secondary)] font-mono border border-[var(--border-subtle)] px-2 py-0.5 rounded-full">{build.branch}</span>
                    <span className="text-[10px] font-black uppercase bg-[var(--bg-primary)] px-2 py-0.5 rounded text-[var(--accent-primary)]">{build.buildTool}</span>
                  </div>
                  <div className="flex gap-4 text-xs text-[var(--text-secondary)]">
                    <span>Duration: {build.duration ? `${build.duration}s` : '—'}</span>
                    <span>Triggered by: {build.triggeredBy}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <button 
                  onClick={(e) => { e.stopPropagation(); toast.success('Artifacts viewed'); }}
                  className="px-3 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg text-xs font-bold text-[var(--text-primary)] flex items-center gap-2 hover:border-[var(--accent-primary)]/50 transition-colors"
                >
                  <Box className="w-3 h-3" /> Artifacts
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); toast.success('Deploy triggered'); }}
                  className="px-3 py-1.5 bg-emerald-600/10 border border-emerald-500/30 text-emerald-500 rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-emerald-600/20 transition-colors"
                >
                  <Rocket className="w-3 h-3" /> Deploy
                </button>
                {expandedBuildId === build.$id ? <ChevronUp className="w-5 h-5 text-[var(--text-secondary)]" /> : <ChevronDown className="w-5 h-5 text-[var(--text-secondary)]" />}
              </div>
            </div>
            
            {expandedBuildId === build.$id && (
              <div className="p-6 bg-[#0d1117] border-t border-[var(--border-subtle)]">
                <div className="flex items-center gap-2 mb-4 text-[var(--text-secondary)] border-b border-gray-800 pb-2">
                  <Terminal className="w-4 h-4" />
                  <span className="text-xs font-mono font-bold">Build Logs Output</span>
                </div>
                <pre className="text-[11px] font-mono text-gray-300 whitespace-pre-wrap max-h-96 overflow-y-auto">
                  {build.logs || 'Waiting for logs...'}
                </pre>
              </div>
            )}
          </div>
        ))}
        {filteredBuilds.length === 0 && !loading && (
          <div className="text-center py-12 text-[var(--text-secondary)] text-sm font-bold uppercase tracking-widest italic premium-card">
            No builds found matching criteria.
          </div>
        )}
        {loading && builds.length === 0 && (
          <div className="flex justify-center py-12">
            <RefreshCw className="w-8 h-8 animate-spin text-[var(--accent-primary)]" />
          </div>
        )}
      </div>
    </div>
  );
}
