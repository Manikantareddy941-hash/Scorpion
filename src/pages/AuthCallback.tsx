import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { account } from '../lib/appwrite';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('Signing you in...');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        setStatus('Establishing session...');
        // Give Appwrite time to set the session cookie
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const user = await account.get();
        if (user) {
          setStatus('Welcome! Redirecting...');
          navigate('/', { replace: true });
        } else {
          navigate('/login', { replace: true });
        }
      } catch (err: any) {
        console.error('OAuth callback error:', err);
        // If 401, session might still be valid - try navigating anyway
        if (err?.code === 401) {
          setStatus('Checking credentials...');
          await new Promise(resolve => setTimeout(resolve, 1000));
          try {
            const user = await account.get();
            if (user) {
              navigate('/', { replace: true });
              return;
            }
          } catch {}
        }
        setStatus('Auth failed: ' + (err?.message || 'Unknown error'));
        setTimeout(() => navigate('/login', { replace: true }), 2000);
      }
    };

    handleCallback();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0D0D0D]">
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-10 text-center shadow-xl">
        <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-white font-medium">{status}</p>
      </div>
    </div>
  );
}
