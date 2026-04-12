import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { account } from '../lib/appwrite';
import { useAuth } from '../contexts/AuthContext';

export default function AuthCallback() {
  const navigate = useNavigate();
  const { setUser, refreshUser } = useAuth();

  useEffect(() => {
    account.getSession('current')
      .then(async (session) => {
        if (session) {
          // If logged in via GitHub, store the GitHub ID in preferences for webhook matching
          if (session.provider === 'github') {
            await account.updatePrefs({ github_user_id: session.providerUid });
          }
          refreshUser().then(user => setUser(user));
          const returnTo = sessionStorage.getItem('oauth_return_to') || '/dashboard';
          sessionStorage.removeItem('oauth_return_to');
          navigate(returnTo, { replace: true });
        } else {
          navigate('/login', { replace: true });
        }
      })
      .catch(() => {
        navigate('/login', { replace: true });
      });
  }, [navigate, setUser, refreshUser]);

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
