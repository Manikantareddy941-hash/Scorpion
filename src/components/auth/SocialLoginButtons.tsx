import { useState } from 'react';
import { OAuthProvider } from 'appwrite';
import { FcGoogle } from 'react-icons/fc';
import { FaGithub, FaMicrosoft } from 'react-icons/fa';
import { SiOkta } from 'react-icons/si';
import NetworkErrorPanel from '../NetworkErrorPanel';
import { useAuth } from '../../contexts/AuthContext';

// Personal-account providers (Google/GitHub) plus enterprise SSO providers
// (Okta, Microsoft/Azure AD, generic OIDC). The enterprise ones only work
// once an admin has registered the corresponding provider in the Appwrite
// console with the org's actual IdP client ID/secret - clicking one before
// that's done will just surface Appwrite's "provider not configured" error,
// the same as it would for any unconfigured OAuth provider.
const providers: { provider: OAuthProvider; icon: JSX.Element; aria: string }[] = [
  { provider: OAuthProvider.Google, icon: <FcGoogle size={28} />, aria: 'Sign in with Google' },
  { provider: OAuthProvider.Github, icon: <FaGithub size={26} color="#1f2937" />, aria: 'Sign in with GitHub' },
  { provider: OAuthProvider.Microsoft, icon: <FaMicrosoft size={22} color="#00A4EF" />, aria: 'Sign in with Microsoft (Azure AD)' },
  { provider: OAuthProvider.Okta, icon: <SiOkta size={24} color="#007DC1" />, aria: 'Sign in with Okta' },
];

export default function SocialLoginButtons() {
  const [loadingProvider, setLoadingProvider] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [networkError, setNetworkError] = useState(false);
  const { signInWithOAuth } = useAuth();

  const handleOAuth = async (provider: OAuthProvider) => {
    setError(null);
    setNetworkError(false);
    setLoadingProvider(provider);
    try {
      sessionStorage.setItem('oauth_return_to', '/dashboard');
      await signInWithOAuth(provider);
    } catch (err: any) {
      if (err?.name === 'TypeError' || /network|ssl|dns|fetch|failed/i.test(err?.message || '')) {
        setNetworkError(true);
      } else {
        setError('OAuth popup closed or error occurred.');
      }
      setLoadingProvider(null);
    }
  };

  if (networkError) return <NetworkErrorPanel onRetry={() => setNetworkError(false)} />;

  return (
    <div className="w-full">
      {error && (
        <div className="bg-[var(--status-error)]/10 border border-[var(--status-error)]/20 rounded-lg p-2 mb-2 text-[var(--status-error)] text-sm text-center font-bold">
          {error}
        </div>
      )}
      <div className="flex gap-4 justify-center">
        {providers.map((p) => (
          <button
            key={p.provider}
            type="button"
            aria-label={p.aria}
            title={p.aria}
            onClick={() => handleOAuth(p.provider)}
            disabled={!!loadingProvider}
            className={`w-11 h-11 flex items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50 hover:shadow-lg hover:border-[var(--accent-primary)]/50 hover:bg-[var(--accent-primary)]/5 ${loadingProvider === p.provider ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            {loadingProvider === p.provider
              ? <span className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              : p.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
