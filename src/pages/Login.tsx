import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import ModernAuthLayout from '../components/auth/ModernAuthLayout';
import SocialLoginButtons from '../components/auth/SocialLoginButtons';
import { useTranslation } from 'react-i18next';

export default function Login() {
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await signIn(email, password);
    if (error) setError(error.message || t('auth.invalid_credentials', 'Invalid credentials'));
    setLoading(false);
  };

  return (
    <ModernAuthLayout
      subtext={t('auth.subtext', 'Clarity. Security. Productivity.')}
    >
      <div className="w-full">
        <h1 className="text-xl font-black mb-1 text-[var(--text-primary)] uppercase italic tracking-tight">
          {t('auth.operator_login', 'Operator Login')}
        </h1>

        <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.15em] mb-8 italic">
          {t('auth.login_desc', 'Provision your secure development identity.')}
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Email */}
          <div className="space-y-2">
            <label htmlFor="email" className="block text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic ml-1">{t('auth.vector_id', 'Vector ID (Email)')}</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50 focus:border-[var(--accent-primary)] text-[var(--text-primary)] placeholder-[var(--text-secondary)] transition-all"
              placeholder={t('auth.email_placeholder', 'Enter your vector ID')}
            />
          </div>

          {/* Password */}
          <div className="space-y-2">
            <label htmlFor="password" title={t('auth.access_key', 'Access Key')} className="block text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic ml-1">{t('auth.access_key', 'Access Key')}</label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50 focus:border-[var(--accent-primary)] text-[var(--text-primary)] placeholder-[var(--text-secondary)] transition-all"
                placeholder={t('auth.password_placeholder', 'Enter access key')}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors"
                aria-label={showPassword ? t('auth.hide_password', 'Hide password') : t('auth.show_password', 'Show password')}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && <div className="text-[var(--status-error)] text-[10px] font-black uppercase tracking-widest italic animate-pulse">{error}</div>}

          {/* Primary Button */}
          <button type="submit" disabled={loading} className="btn-premium w-full flex items-center justify-center gap-3 py-4">
            {loading ? <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" /> : (
              <>
                <LogIn size={18} />
                <span>{t('auth.login', 'Login').toUpperCase()}</span>
              </>
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="my-8 flex items-center px-4">
          <div className="flex-grow h-px bg-[var(--border-subtle)]" />
          <span className="mx-4 text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-[0.3em] italic">{t('auth.secondary_auth', 'Secondary Authentication')}</span>
          <div className="flex-grow h-px bg-[var(--border-subtle)]" />
        </div>

        {/* Social Buttons */}
        <SocialLoginButtons />

        <p className="mt-10 text-center text-[10px] font-black uppercase tracking-widest italic text-[var(--text-secondary)]">
          {t('auth.new_operative', 'New operative?')}{' '}
          <a href="/signup" className="text-[var(--accent-primary)] hover:underline decoration-2 underline-offset-4 decoration-[var(--accent-primary)]/30 transition-all">
            {t('auth.request_access', 'Request Access')}
          </a>
        </p>
      </div>
    </ModernAuthLayout>
  );
}
