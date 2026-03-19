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

  return (
    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
      {loading && <span>Checking server...</span>}
      {error && <span style={{ color: '#f87171' }}>{error}</span>}
      {status && !loading && (
        <span style={{ color: '#4ade80' }}>
          Server: {status.status ?? 'ok'}
        </span>
      )}
    </div>
  );
}
