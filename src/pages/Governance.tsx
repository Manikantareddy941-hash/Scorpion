import React, { useEffect, useState } from 'react';
import { Shield, Gavel, CheckCircle, XCircle, AlertTriangle, ArrowRight, Activity, FileText } from 'lucide-react';

export default function Governance() {
  const [controls, setControls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCompliance();
  }, []);

  const fetchCompliance = async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/compliance`);
      const data = await res.json();
      setControls(data.documents ?? []);
    } catch (err) {
      console.error('Failed to fetch compliance:', err);
    } finally {
      setLoading(false);
    }
  };

  const triggerEvaluation = async () => {
    setLoading(true);
    try {
      await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/compliance/evaluate`, { method: 'POST' });
      await fetchCompliance();
    } catch (err) {
      console.error('Evaluation failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const passing = controls.filter(c => c.status === 'passing').length;
  const score = controls.length ? Math.round((passing / controls.length) * 100) : 0;

  if (loading && controls.length === 0) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="animate-pulse text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">Evaluating Controls...</div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-black uppercase italic tracking-tighter text-[var(--text-primary)]">Governance & Compliance</h1>
          <p className="text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.2em] italic mt-1">Regulatory Mapping (SOC2 / ISO 27001)</p>
        </div>
        <button 
          onClick={triggerEvaluation}
          disabled={loading}
          className="px-6 py-2.5 bg-[var(--accent-primary)] text-black text-[10px] font-black uppercase tracking-widest italic rounded-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
        >
          {loading ? 'Evaluating...' : 'Trigger Audit Re-scan'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="premium-card p-8 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform">
            <Shield className="w-20 h-20" />
          </div>
          <p className="text-[10px] uppercase font-black text-[var(--text-secondary)] tracking-widest mb-2">Compliance Score</p>
          <p className="text-5xl font-black italic tracking-tighter" style={{ color: score > 80 ? 'var(--status-success)' : 'var(--status-warning)' }}>{score}%</p>
        </div>
        
        <div className="premium-card p-8 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform">
            <CheckCircle className="w-20 h-20" />
          </div>
          <p className="text-[10px] uppercase font-black text-[var(--text-secondary)] tracking-widest mb-2">Passing Controls</p>
          <p className="text-5xl font-black italic tracking-tighter text-[var(--status-success)]">{passing}</p>
        </div>

        <div className="premium-card p-8 relative overflow-hidden group border-red-500/20">
          <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform">
            <AlertTriangle className="w-20 h-20 text-red-500" />
          </div>
          <p className="text-[10px] uppercase font-black text-[var(--text-secondary)] tracking-widest mb-2">Remediation Required</p>
          <p className="text-5xl font-black italic tracking-tighter text-red-500">{controls.length - passing}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {['SOC2', 'ISO27001'].map(framework => (
          <div key={framework} className="flex flex-col gap-4">
            <div className="flex items-center gap-3 mb-2">
              <Gavel className="w-5 h-5 text-[var(--accent-primary)]" />
              <h2 className="text-lg font-black uppercase italic tracking-tight text-[var(--text-primary)]">{framework} Framework</h2>
            </div>
            
            <div className="flex flex-col gap-3">
              {controls.filter(c => c.framework === framework).map(c => (
                <div key={c.controlId} className="premium-card p-6 flex flex-col gap-4 hover:border-[var(--accent-primary)]/40 transition-all cursor-pointer">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-black text-[var(--accent-primary)] tracking-widest">{c.controlId}</span>
                        <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">·</span>
                        <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">{framework}</span>
                      </div>
                      <h3 className="text-sm font-black text-[var(--text-primary)] uppercase italic leading-tight">{c.title}</h3>
                    </div>
                    <span className={`text-[9px] font-black px-2.5 py-1 rounded-lg uppercase tracking-tighter ${
                      c.status === 'passing' ? 'bg-[var(--status-success)]/10 text-[var(--status-success)]' : 'bg-red-500/10 text-red-400'
                    }`}>
                      {c.status}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-[var(--border-subtle)]/50">
                    <div className="flex items-center gap-4">
                      <div className="flex flex-col">
                        <span className="text-[8px] font-black text-[var(--text-secondary)] uppercase">Last Audit</span>
                        <span className="text-[9px] font-bold text-[var(--text-primary)]">{new Date(c.lastEvaluated).toLocaleDateString()}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[8px] font-black text-[var(--text-secondary)] uppercase">Evidence</span>
                        <span className="text-[9px] font-bold text-[var(--text-primary)]">{JSON.parse(c.evidence || '[]').length} Logs</span>
                      </div>
                    </div>
                    <button className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors">
                      View Audit Trail <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
