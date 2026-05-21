import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Rocket, RefreshCw, XCircle, RotateCcw, Clock, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Deploy() {
  const { getJWT } = useAuth();
  const [deployments, setDeployments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDeployments = async () => {
    try {
      const token = await getJWT();
      const res = await fetch('/api/deployments', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDeployments(data.documents || []);
      }
    } catch (err) {
      console.error('Failed to fetch deployments:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeployments();
    const interval = setInterval(fetchDeployments, 15000);
    return () => clearInterval(interval);
  }, []);

  const triggerDeploy = async (environment: string) => {
    const buildId = window.prompt(`Enter Build ID to deploy to ${environment}:`);
    if (buildId) {
      try {
        const token = await getJWT();
        toast.loading(`Deploying to ${environment}...`, { id: 'deploy' });
        const res = await fetch('/api/deployments/trigger', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ buildId, environment })
        });
        
        if (res.ok) {
          toast.success(`Deployment to ${environment} triggered`, { id: 'deploy' });
          fetchDeployments();
        } else {
          toast.error("Failed to trigger deployment", { id: 'deploy' });
        }
      } catch (err) {
        toast.error("Error triggering deployment", { id: 'deploy' });
      }
    }
  };

  const triggerRollback = async (deploymentId: string) => {
    if (window.confirm("Are you sure you want to rollback this deployment?")) {
      try {
        const token = await getJWT();
        toast.loading("Initiating rollback...", { id: 'rollback' });
        const res = await fetch(`/api/deployments/${deploymentId}/rollback`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.ok) {
          toast.success("Rollback successful", { id: 'rollback' });
          fetchDeployments();
        } else {
          toast.error("Rollback failed", { id: 'rollback' });
        }
      } catch (err) {
        toast.error("Error during rollback", { id: 'rollback' });
      }
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10';
      case 'failed': return 'text-red-500 border-red-500/30 bg-red-500/10';
      case 'running': return 'text-amber-500 border-amber-500/30 bg-amber-500/10';
      case 'rolled-back': return 'text-gray-400 border-gray-400/30 bg-gray-400/10';
      default: return 'text-blue-500 border-blue-500/30 bg-blue-500/10';
    }
  };

  const environments = ['dev', 'staging', 'production'];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex items-center gap-5 mb-12">
        <div className="w-14 h-14 bg-emerald-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-emerald-600/20">
          <Rocket className="w-7 h-7" />
        </div>
        <div>
          <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tighter uppercase italic">Deployments</h1>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.2em] mt-1 italic font-mono">Environment Delivery</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {environments.map(env => {
          const envDeploys = deployments.filter(d => d.environment === env);
          const activeDeploy = envDeploys[0]; // Assuming sorted by newest
          
          return (
            <div key={env} className="flex flex-col gap-4">
              <div className="premium-card p-6 flex flex-col items-center justify-center min-h-[200px] relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                  <Rocket className="w-32 h-32" />
                </div>
                <h2 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-widest relative z-10 mb-4">{env}</h2>
                
                {activeDeploy ? (
                  <div className="text-center relative z-10 mb-6">
                    <p className={`text-sm font-bold uppercase tracking-widest border px-3 py-1 rounded-full mb-2 inline-block ${getStatusColor(activeDeploy.status)}`}>
                      {activeDeploy.status}
                    </p>
                    <p className="text-xs font-mono text-[var(--text-primary)] bg-[var(--bg-primary)] px-2 py-1 rounded border border-[var(--border-subtle)] mt-2">
                      {activeDeploy.imageTag}
                    </p>
                    <p className="text-[10px] text-[var(--text-secondary)] uppercase tracking-widest mt-2">
                      {new Date(activeDeploy.deployedAt || activeDeploy.$createdAt).toLocaleString()}
                    </p>
                  </div>
                ) : (
                  <div className="text-center relative z-10 mb-6">
                    <p className="text-xs text-[var(--text-secondary)] uppercase tracking-widest italic">No active deployment</p>
                  </div>
                )}
                
                <button 
                  onClick={() => triggerDeploy(env)}
                  className="btn-premium w-full flex items-center justify-center gap-2 relative z-10 mt-auto"
                  style={{ background: 'var(--bg-primary)' }}
                >
                  <Rocket className="w-4 h-4" /> Deploy to {env}
                </button>
              </div>

              <div className="flex-1 bg-[var(--bg-card)] rounded-[16px] border border-[var(--border-subtle)] overflow-hidden flex flex-col">
                <div className="p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/50">
                  <h3 className="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)]">History</h3>
                </div>
                <div className="flex-1 overflow-y-auto max-h-[400px] divide-y divide-[var(--border-subtle)]">
                  {envDeploys.map(deploy => (
                    <div key={deploy.$id} className="p-4 hover:bg-[var(--bg-primary)]/30 transition-colors flex flex-col gap-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-mono text-[var(--text-primary)] truncate max-w-[150px]">{deploy.imageTag}</span>
                        <span className={`w-2 h-2 rounded-full ${deploy.status === 'success' ? 'bg-emerald-500' : deploy.status === 'failed' ? 'bg-red-500' : deploy.status === 'running' ? 'bg-amber-500 animate-pulse' : 'bg-gray-500'}`} title={deploy.status} />
                      </div>
                      <div className="flex justify-between items-end">
                        <span className="text-[9px] text-[var(--text-secondary)] uppercase tracking-wider">
                          {new Date(deploy.$createdAt).toLocaleDateString()}
                        </span>
                        {deploy.status === 'success' && (
                          <button 
                            onClick={() => triggerRollback(deploy.$id)}
                            className="text-[9px] font-bold text-red-500 hover:text-red-400 uppercase tracking-widest flex items-center gap-1"
                          >
                            <RotateCcw className="w-3 h-3" /> Rollback
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {envDeploys.length === 0 && (
                    <div className="p-8 text-center text-[10px] text-[var(--text-secondary)] uppercase tracking-widest italic">
                      Empty history
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
