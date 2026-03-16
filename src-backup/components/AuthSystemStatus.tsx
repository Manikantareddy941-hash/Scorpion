import { useEffect, useState } from 'react';

type Status = {
  status?: string;
  services?: {
    database?: string;
    email?: string;
    gateway?: string;
  };
};

export default function AuthSystemStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStatus = async () => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('http://localhost:3001/health');

      if (!res.ok) throw new Error('Request failed');

      const data = await res.json();
      setStatus(data);
    } catch (err) {
      setError('Cannot reach server');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

<<<<<<< HEAD
  if (loading) {
    return (
      <div className="text-xs text-gray-500 dark:text-gray-400">
        Checking authentication system…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/40 border border-red-200 dark:border-red-700 rounded-xl p-3 text-red-700 dark:text-red-100 text-xs">
        {error}
        <button
          onClick={fetchStatus}
          className="ml-2 px-2 py-1 rounded bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-xs font-semibold"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-green-600">● Backend reachable</span>
      <span className="text-green-600">● Auth service healthy</span>
=======
  if (loading) return <div className="text-xs text-slate-500 dark:text-slate-400">Checking authentication system…</div>;

  if (error) return (
    <div className="bg-red-50 dark:bg-red-900/40 border border-red-200 dark:border-red-700 rounded-xl p-3 text-red-700 dark:text-red-100 text-xs">
      {error}
      <button onClick={fetchStatus} className="ml-2 px-2 py-1 rounded bg-blue-600 text-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all duration-200">Retry</button>
    </div>
  );

  const { backend, appwrite, env, cors, details } = status || {};
  const allOk = backend === 'ok' && appwrite === 'ok' && env?.APPWRITE_ENDPOINT && env?.APPWRITE_PROJECT_ID && env?.FRONTEND_URL && cors === 'ok';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs">
        <span className={backend === 'ok' ? 'text-emerald-600' : 'text-rose-600'}>● Backend {backend === 'ok' ? 'reachable' : 'fail'}</span>
        <span className={appwrite === 'ok' ? 'text-emerald-600' : 'text-rose-600'}>● Appwrite {appwrite === 'ok' ? 'reachable' : 'fail'}</span>
        <span className={env?.APPWRITE_ENDPOINT && env?.APPWRITE_PROJECT_ID && env?.FRONTEND_URL ? 'text-emerald-600' : 'text-rose-600'}>● Env configured</span>
        <span className={cors === 'ok' ? 'text-emerald-600' : 'text-rose-600'}>● CORS {cors === 'ok' ? 'ok' : 'fail'}</span>
        {!allOk && <button onClick={fetchStatus} className="ml-2 px-2 py-1 rounded bg-blue-600 text-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all duration-200">Retry</button>}
      </div>
      {details && (
        <div className="text-[10px] text-rose-500 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-1.5 rounded-lg font-mono break-all max-w-2xl">
          <strong>Backend Error:</strong> {typeof details === 'string' ? details : JSON.stringify(details)}
        </div>
      )}
      {!allOk && !details && <div className="text-rose-600 font-semibold text-xs mt-1 italic uppercase tracking-tight">Authentication system misconfigured. Check backend logs.</div>}
>>>>>>> 98f3544 (ui updates)
    </div>
  );
}
