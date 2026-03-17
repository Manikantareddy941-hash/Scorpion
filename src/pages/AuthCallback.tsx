import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { account } from '../lib/appwrite';
import { useAuth } from '../contexts/AuthContext';

export default function AuthCallback() {
  const navigate = useNavigate();
  const { setUser } = useAuth();

  useEffect(() => {
    const handleCallback = async () => {
      const params = new URLSearchParams(window.location.search);
      const userId = params.get('userId');
      const secret = params.get('secret');

      if (userId && secret) {
        try {
          await account.createSession(userId, secret);
          const user = await account.get();
          setUser(user);
          navigate('/', { replace: true });
        } catch (err) {
          console.error('Failed to create session:', err);
          navigate('/login', { replace: true });
        }
      } else {
        navigate('/login', { replace: true });
      }
    };

    handleCallback();
  }, [navigate, setUser]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0D0D0D]">
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-10 text-center shadow-xl">
        <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent 
                        rounded-full animate-spin mx-auto mb-4" />
        <p className="text-white font-medium">Completing secure login...</p>
        <p className="text-gray-500 text-sm mt-2">Establishing session...</p>
      </div>
    </div>
  );
}
