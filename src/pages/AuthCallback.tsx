import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
<<<<<<< HEAD
=======
import { useAuth } from '../contexts/AuthContext';
>>>>>>> 98f3544 (ui updates)
import { account } from '../lib/appwrite';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('Signing you in...');

  useEffect(() => {
<<<<<<< HEAD
    async function handleCallback() {
      // Wait for Appwrite to set the session cookie
      await new Promise(r => setTimeout(r, 1500));

      let attempts = 0;
      const maxAttempts = 5;

      while (attempts < maxAttempts) {
        try {
          const user = await account.get();
          if (user) {
            console.log('OAuth success, user:', user.$id);
            navigate('/dashboard', { replace: true });
            return;
          }
        } catch (err: any) {
          console.log(`Attempt ${attempts + 1} failed:`, err.message);
          attempts++;
          if (attempts < maxAttempts) {
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      }

      console.error('All attempts failed');
      setStatus('Authentication failed. Please try again.');
      setTimeout(() => navigate('/login', { replace: true }), 2000);
    }

    handleCallback();
=======
    const checkAppwriteSession = async () => {
      try {
        // Appwrite session is usually handled by cookies automatically on redirect
        await account.get();
        // If successful, the cookie is set and account info retrieved
        setTimeout(() => {
          navigate('/dashboard');
        }, 500);
      } catch (err: any) {
        console.error('Auth callback error:', err);
        setError('Authentication failed. Please try again.');
      }
    };
    
    checkAppwriteSession();
>>>>>>> 98f3544 (ui updates)
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="bg-white rounded-2xl p-10 text-center shadow-xl">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-700 font-medium">{status}</p>
      </div>
    </div>
  );
}
