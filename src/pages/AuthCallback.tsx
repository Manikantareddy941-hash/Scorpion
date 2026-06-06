import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function AuthCallback() {
  const { refreshUser } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const handleCallback = async () => {
      // Give Appwrite a moment to finalize the OAuth session cookie
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const user = await refreshUser();
      const returnTo = sessionStorage.getItem('oauth_return_to') || '/dashboard';
      sessionStorage.removeItem('oauth_return_to');

      if (user) {
        navigate(returnTo, { replace: true });
      } else {
        navigate('/login?error=oauth_failed', { replace: true });
      }
    };

    handleCallback();
  }, [navigate, refreshUser]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0D0D0D]">
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-10 text-center shadow-xl">
        <div className="w-10 h-10 border-4 border-[var(--accent-primary)] border-t-transparent 
                        rounded-full animate-spin mx-auto mb-4" />
        <p className="text-white font-black uppercase italic tracking-tight">Synchronizing neural identity...</p>
        <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mt-2">Establishing secure session context</p>
      </div>
    </div>
  );
}
