import { useEffect, useState } from 'react';

export default function AuthSystemStatus() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStatus = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/health/auth');
      if (!res.ok) throw new Error('Network error');
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

  if (loading) return <div className="text-xs text-gray-500 dark:text-gray-400">Checking authentication system…</div>;

  if (error) return (
    <div className="bg-red-50 dark:bg-red-900/40 border border-red-200 dark:border-red-700 rounded-xl p-3 text-red-700 dark:text-red-100 text-xs">
      {error}
      <button onClick={fetchStatus} className="ml-2 px-2 py-1 rounded bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all duration-200">Retry</button>
    </div>
  );

  const { backend, supabase, env, cors } = status || {};
  const allOk = backend === 'ok' && supabase === 'ok' && env?.SUPABASE_URL && env?.SUPABASE_SERVICE_ROLE_KEY && env?.FRONTEND_URL && cors === 'ok';

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={backend === 'ok' ? 'text-green-600' : 'text-red-600'}>● Backend {backend === 'ok' ? 'reachable' : 'fail'}</span>
      <span className={supabase === 'ok' ? 'text-green-600' : 'text-red-600'}>● Supabase {supabase === 'ok' ? 'reachable' : 'fail'}</span>
      <span className={env?.SUPABASE_URL && env?.SUPABASE_SERVICE_ROLE_KEY && env?.FRONTEND_URL ? 'text-green-600' : 'text-red-600'}>● Env configured</span>
      <span className={cors === 'ok' ? 'text-green-600' : 'text-red-600'}>● CORS {cors === 'ok' ? 'ok' : 'fail'}</span>
      {!allOk && <span className="text-red-600 font-semibold ml-2">Authentication system misconfigured. Check backend logs.</span>}
      {!allOk && <button onClick={fetchStatus} className="ml-2 px-2 py-1 rounded bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all duration-200">Retry</button>}
    </div>
  );
}
