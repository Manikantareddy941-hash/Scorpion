import { supabase } from '../../lib/supabase';
import { useState } from 'react';
import { FcGoogle } from 'react-icons/fc';
import { FaGithub } from 'react-icons/fa';
import NetworkErrorPanel from '../NetworkErrorPanel';

const providers = [
  {
    provider: 'google',
    icon: <FcGoogle size={28} />,
    aria: 'Sign in with Google',
  },
  {
    provider: 'github',
    icon: <FaGithub size={26} color="#1f2937" />,
    aria: 'Sign in with GitHub',
  },
];

export default function SocialLoginButtons() {
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [networkError, setNetworkError] = useState(false);

  const handleOAuth = async (provider: string) => {
    setError(null);
    setNetworkError(false);
    setLoadingProvider(provider);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: provider as any,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) {
        setError(error.message || 'OAuth error.');
        setLoadingProvider(null);
      }
    } catch (err: any) {
      // Detect network/SSL/DNS errors
      if (
        err?.name === 'TypeError' ||
        /network|ssl|dns|fetch|failed/i.test(err?.message || '')
      ) {
        if (import.meta.env.DEV) console.error('Supabase network error:', err);
        setNetworkError(true);
      } else {
        setError('OAuth popup closed or error occurred.');
      }
      setLoadingProvider(null);
    }
  };

  if (networkError) {
    return <NetworkErrorPanel onRetry={() => setNetworkError(false)} />;
  }

  return (
    <div className="w-full">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2 mb-2 text-red-700 text-sm text-center">
          {error}
        </div>
      )}
      <div className="flex gap-4 justify-center">
        {providers.map((p) => (
          <button
            key={p.provider}
            type="button"
            aria-label={p.aria}
            onClick={() => handleOAuth(p.provider)}
            disabled={!!loadingProvider}
            className={`w-11 h-11 flex items-center justify-center rounded-full border border-gray-300 dark:border-white/10 bg-white dark:bg-white/10 shadow transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 hover:shadow-lg hover:border-indigo-400 dark:hover:border-indigo-300 hover:bg-gradient-to-br hover:from-indigo-100 hover:to-purple-100 dark:hover:bg-white/20 ${loadingProvider === p.provider ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            {loadingProvider === p.provider ? (
              <span className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            ) : (
              p.icon
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
