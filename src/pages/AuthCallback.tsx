import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function AuthCallback() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error || !data.session) {
          setError('Authentication failed. Please try again.');
          return;
        }
        // Wait for AuthContext to update user
        setTimeout(() => {
          navigate('/dashboard');
        }, 500);
      } catch (err: any) {
        setError('An unexpected error occurred.');
      }
    };
    checkSession();
  }, [navigate]);

  useEffect(() => {
    if (!loading && user) {
      navigate('/dashboard');
    }
  }, [user, loading, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-8 flex flex-col items-center">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Signing you in…</h2>
        {error && <p className="text-red-600 text-center mt-2">{error}</p>}
        {!error && <p className="text-gray-500 dark:text-gray-400">Please wait while we verify your account.</p>}
      </div>
    </div>
  );
}
