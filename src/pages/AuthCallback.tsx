import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { account } from '../lib/appwrite';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('Signing you in...');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        setStatus('Verifying session...');
        const user = await account.get();
        if (user) {
          setStatus('Welcome back!');
          setTimeout(() => navigate('/'), 500);
        } else {
          setStatus('Session not found. Redirecting...');
          setTimeout(() => navigate('/login'), 1500);
        }
      } catch (err) {
        console.error('OAuth callback error:', err);
        setStatus('Authentication failed. Redirecting...');
        setTimeout(() => navigate('/login'), 1500);
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
