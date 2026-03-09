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
    </div>
  );
}
