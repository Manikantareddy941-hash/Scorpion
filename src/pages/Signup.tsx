import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { UserPlus, Eye, EyeOff } from 'lucide-react';
import ModernAuthLayout from '../components/auth/ModernAuthLayout';
import SocialLoginButtons from '../components/auth/SocialLoginButtons';
import { useTranslation } from 'react-i18next';

function getStrength(password: string) {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return score;
}

export default function Signup() {
  const { t } = useTranslation();
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const strength = getStrength(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (password !== confirm) {
      setError(t('auth.passwords_not_match', 'Passwords do not match'));
      return;
    }
    setLoading(true);
    const { error } = await signUp(email, password);
    if (error) setError(error.message || t('auth.signup_failed', 'Signup failed'));
    else setSuccess(t('auth.signup_success', 'Account created! Check your email to verify.'));
    setLoading(false);
  };

  return (
    <ModernAuthLayout
      subtext={t('auth.signup_subtext', 'Modern DevOps, Secure by Default.')}
    >
      <div className="w-full">
        <h1 className="text-xl font-black mb-1 text-[var(--text-primary)] uppercase italic tracking-tight">
          {t('auth.join_fleet', 'Join the Fleet')}
        </h1>

        <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.15em] mb-8 italic">
          {t('auth.provision_identity', 'Provision your operator identity.')}
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

            {/* Strength Indicator */}
            <div className="mt-3 px-1">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic">{t('auth.signal_strength', 'Signal Strength')}</span>
                <span className={`text-[8px] font-black uppercase italic ${
                  strength >= 4 ? 'text-[var(--status-success)]' :
                  strength >= 3 ? 'text-blue-500' :
                  strength >= 2 ? 'text-yellow-500' :
                  strength >= 1 ? 'text-[var(--status-error)]' : 'text-[var(--text-secondary)]'
                }`}>
                  {strength >= 4 ? t('auth.strength_optimal', 'Optimal') : 
                   strength >= 3 ? t('auth.strength_strong', 'Strong') : 
                   strength >= 2 ? t('auth.strength_fair', 'Fair') : 
                   strength >= 1 ? t('auth.strength_weak', 'Weak') : 
                   t('auth.strength_none', 'None')}
                </span>
              </div>
              <div className="h-1 w-full bg-[#1E1E1E] rounded-full overflow-hidden flex gap-1">
                {[1, 2, 3, 4].map((step) => (
                  <div
                    key={step}
                    className={`h-full flex-1 transition-all duration-500 ${
                      strength >= step ? (
                        strength >= 4 ? 'bg-[var(--status-success)]' :
                        strength >= 3 ? 'bg-blue-500' :
                        strength >= 2 ? 'bg-yellow-500' :
                        'bg-[var(--status-error)]'
                      ) : 'bg-[var(--bg-secondary)]'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Confirm Password */}
          <div className="space-y-2">
            <label htmlFor="confirm" className="block text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic ml-1">{t('auth.verify_key', 'Verify Key')}</label>
            <input
              id="confirm"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50 focus:border-[var(--accent-primary)] text-[var(--text-primary)] placeholder-[var(--text-secondary)] transition-all"
              placeholder={t('auth.password_placeholder', 'Enter access key')}
            />
          </div>

          {error && <div className="text-[var(--status-error)] text-[10px] font-black uppercase tracking-widest italic animate-pulse">{error}</div>}
          {success && <div className="text-[var(--status-success)] text-[10px] font-black uppercase tracking-widest italic">{success}</div>}

          {/* Primary Button */}
          <button type="submit" disabled={loading} className="btn-premium w-full flex items-center justify-center gap-3 py-4">
            {loading ? <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" /> : (
              <>
                <UserPlus size={18} />
                <span>{t('auth.create_account', 'Create Account').toUpperCase()}</span>
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
          {t('auth.already_active', 'Already active?')}{' '}
          <a href="/login" className="text-[var(--accent-primary)] hover:underline decoration-2 underline-offset-4 decoration-[var(--accent-primary)]/30 transition-all">
            {t('auth.initiate_session', 'Initiate Session')}
          </a>
        </p>
      </div>
    </ModernAuthLayout>
  );
}
