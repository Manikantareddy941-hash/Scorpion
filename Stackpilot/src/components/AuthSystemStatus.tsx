import { useEffect, useState } from 'react';

type HealthStatus = {
  backend?: string;
  supabase?: string;
  env?: {
    SUPABASE_URL?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
    FRONTEND_URL?: string;
  };
  cors?: string;
};

export default function AuthSystemStatus() {
  const [status, setStatus] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStatus = async () => {
    setLoading(true);
    setError('');

    try {
      // ✅ CORRECT endpoint
      const res = await fetch('/api/health');

      if (!res.ok) throw new Error('Network error');

      const data = await res.json();
      setStatus(data);
    } catch (err) {
      console.error(err);
      setError('Cannot reach server');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  if (loading)
    return (
      <div className="text-xs text-gray-500 dark:text-gray-400">
        Checking authentication system…
      </div>
    );

  if (error)
    return (
      <div className="bg-red-50 dark:bg-red-900/40 border border-red-200 dark:border-red-700 rounded-xl p-3 text-red-700 dark:text-red-100 text-xs">
        {error}
        <button
          onClick={fetchStatus}
          className="ml-2 px-2 py-1 rounded bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all duration-200"
        >
          Retry
        </button>
      </div>
    );

  const { backend, supabase, env, cors } = status || {};

  const envOk = env?.SUPABASE_URL && env?.SUPABASE_SERVICE_ROLE_KEY && env?.FRONTEND_URL;
  const allOk = backend === 'ok' && supabase === 'ok' && envOk && cors === 'ok';

  return (
    <div className="flex flex-wrap items-center gap-3 py-2 px-4 bg-surface/50 border border-border rounded-lg animate-fade-up">
      <div className="flex items-center gap-4 mr-4">
        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Intelligence Health</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge label="Engine" status={backend === 'ok' ? 'success' : 'danger'} />
        <StatusBadge label="Storage" status={supabase === 'ok' ? 'success' : 'danger'} />
        <StatusBadge label="Config" status={envOk ? 'success' : 'danger'} />
        <StatusBadge label="Network" status={cors === 'ok' ? 'success' : 'danger'} />
      </div>

      {!allOk && (
        <div className="flex items-center gap-3 ml-auto pl-4 border-l border-border">
          <span className="text-[12px] text-danger font-medium">Critical configuration failure detected</span>
          <button
            onClick={fetchStatus}
            className="btn-primary !py-1 !px-3 !text-[11px]"
          >
            Retry Sync
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ label, status }: { label: string, status: 'success' | 'danger' | 'warning' | 'neutral' }) {
  return (
    <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded border ${status === 'success' ? 'bg-success-light border-success/10 text-success' :
      status === 'danger' ? 'bg-danger-light border-danger/10 text-danger' :
        'bg-surface border-border text-text-muted'
      }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'success' ? 'bg-success' :
        status === 'danger' ? 'bg-danger' : 'bg-subtle'
        }`} />
      <span className="text-[10px] font-bold uppercase tracking-tight">{label}</span>
    </div>
  );
}