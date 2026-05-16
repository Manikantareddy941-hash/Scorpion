import React, { useState } from 'react';
import { X, Globe, Shield, Lock, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';

const PROVIDERS = [
  { id: 'github',    label: 'GitHub',        color: '#ffffff', bg: '#24292e', icon: Globe, tokenLabel: 'Personal Access Token' },
  { id: 'gitlab',    label: 'GitLab',        color: '#fc6d26', bg: '#fca3261a', icon: Shield, tokenLabel: 'Personal Access Token' },
  { id: 'bitbucket', label: 'Bitbucket',     color: '#0052cc', bg: '#0052cc1a', icon: Lock, tokenLabel: 'App Password' },
  { id: 'azure',     label: 'Azure DevOps',  color: '#0078d4', bg: '#0078d41a', icon: ExternalLink, tokenLabel: 'Personal Access Token' },
];

export default function ConnectRepoModal({ onClose }: { onClose: () => void }) {
  const [provider, setProvider] = useState('github');
  const [token, setToken] = useState('');
  const [repos, setRepos] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState<string | null>(null);

  const fetchRepos = async () => {
    if (!token) return toast.error('Please enter an access token');
    setLoading(true);
    try {
      const res = await fetch(`/api/repos/external?provider=${provider}`, {
        headers: { 'x-provider-token': token }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch repositories');
      setRepos(data.repos ?? []);
      toast.success(`Fetched ${data.repos?.length || 0} repositories`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const triggerScan = async (repo: any) => {
    setScanning(repo.id);
    const toastId = toast.loading(`Initiating scan for ${repo.fullName}...`);
    try {
      const res = await fetch('/api/repos/external/scan', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'x-provider-token': token
        },
        body: JSON.stringify({ 
            provider, 
            repoFullName: repo.fullName, 
            cloneUrl: repo.cloneUrl,
            branch: repo.defaultBranch 
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to trigger scan');
      
      toast.success('Scan triggered successfully. Processing in background.', { id: toastId });
      onClose();
    } catch (err: any) {
      toast.error(err.message, { id: toastId });
    } finally {
      setScanning(null);
    }
  };

  const activeProvider = PROVIDERS.find(p => p.id === provider);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[1000] flex items-center justify-center p-4">
      <div className="bg-[var(--bg-card)] w-full max-w-2xl rounded-3xl border border-[var(--border-subtle)] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
        
        {/* Header */}
        <div className="p-8 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-primary)]/50">
          <div>
            <h2 className="text-2xl font-black uppercase italic tracking-tighter text-[var(--text-primary)]">Connect Repository</h2>
            <p className="text-[10px] text-[var(--text-secondary)] uppercase font-black tracking-widest mt-1">Multi-Provider Security Onboarding</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[var(--bg-primary)] rounded-full transition-colors">
            <X size={20} className="text-[var(--text-secondary)]" />
          </button>
        </div>

        <div className="p-8">
          {/* Provider selector */}
          <div className="grid grid-cols-4 gap-3 mb-8">
            {PROVIDERS.map(p => (
              <button key={p.id}
                onClick={() => {
                    setProvider(p.id);
                    setRepos([]);
                }}
                className={`flex flex-col items-center gap-3 p-4 rounded-2xl border-2 transition-all duration-300 group
                    ${provider === p.id 
                        ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/5 scale-[1.02]' 
                        : 'border-[var(--border-subtle)] hover:border-[var(--text-secondary)]/50'}`}
              >
                <div className={`p-3 rounded-xl transition-transform group-hover:scale-110 shadow-sm`}
                     style={{ background: p.bg }}>
                  <p.icon size={20} style={{ color: p.color }} />
                </div>
                <span className={`text-[10px] font-black uppercase tracking-widest ${provider === p.id ? 'text-[var(--accent-primary)]' : 'text-[var(--text-secondary)]'}`}>
                  {p.label}
                </span>
              </button>
            ))}
          </div>

          {/* Token input */}
          <div className="space-y-4 mb-8">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] mb-2 block">
                {activeProvider?.tokenLabel}
              </label>
              <div className="relative">
                <input
                  type="password"
                  placeholder={`Paste your ${activeProvider?.label} token here...`}
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl px-5 py-4 text-sm font-medium focus:outline-none focus:border-[var(--accent-primary)] transition-all shadow-inner"
                />
              </div>
            </div>

            <button 
              onClick={fetchRepos}
              disabled={loading || !token}
              className="w-full py-4 bg-[var(--accent-primary)] text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 disabled:grayscale shadow-lg shadow-[var(--accent-primary)]/20"
            >
              {loading ? 'Discovering Assets...' : 'Fetch Repositories'}
            </button>
          </div>

          {/* Repo list */}
          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
            {repos.length > 0 ? (
              repos.map(repo => (
                <div key={repo.id} className="flex items-center justify-between p-4 bg-[var(--bg-primary)]/30 rounded-2xl border border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/50 transition-all group">
                  <div className="min-w-0">
                    <p className="text-[12px] font-black text-[var(--text-primary)] truncate">{repo.fullName}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[9px] text-[var(--text-secondary)] font-mono uppercase tracking-tighter">Branch: {repo.defaultBranch}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] font-black uppercase tracking-widest">{repo.provider}</span>
                    </div>
                  </div>
                  <button 
                    onClick={() => triggerScan(repo)}
                    disabled={!!scanning}
                    className="flex-shrink-0 px-4 py-2 bg-[var(--bg-card)] border border-[var(--accent-primary)]/30 text-[var(--accent-primary)] text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-[var(--accent-primary)] hover:text-white transition-all disabled:opacity-50"
                  >
                    {scanning === repo.id ? 'Starting...' : 'Onboard'}
                  </button>
                </div>
              ))
            ) : token && !loading ? (
              <div className="text-center py-12 bg-[var(--bg-primary)]/20 rounded-2xl border-2 border-dashed border-[var(--border-subtle)]">
                <Globe className="w-8 h-8 text-[var(--text-secondary)] opacity-20 mx-auto mb-3" />
                <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic">No repositories found or token invalid</p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="p-8 bg-[var(--bg-primary)]/30 border-t border-[var(--border-subtle)] flex justify-center">
            <p className="text-[9px] text-[var(--text-secondary)] font-black uppercase tracking-widest opacity-50 italic">
                Securely connected via AES-256 encrypted transit
            </p>
        </div>
      </div>
    </div>
  );
}
