import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { UserPlus, Eye, EyeOff } from 'lucide-react';
import ModernAuthLayout from '../components/auth/ModernAuthLayout';
import SocialLoginButtons from '../components/auth/SocialLoginButtons';

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
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    const { error } = await signUp(email, password);
    if (error) setError(error.message || 'Signup failed');
    else setSuccess('Account created! Check your email to verify.');
    setLoading(false);
  };

  return (
    <ModernAuthLayout
      subtext="Modern DevOps, Secure by Default."
    >
      <div className="w-full">
        <h1 className="text-xl font-black mb-1 text-white uppercase italic tracking-tight">
          Join the Fleet
        </h1>

        <p className="text-[10px] font-bold text-[#666666] uppercase tracking-[0.15em] mb-8 italic">
          Provision your secure development identity.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Email */}
          <div className="space-y-2">
            <label htmlFor="email" className="block text-[10px] font-black text-[#666666] uppercase tracking-widest italic ml-1">Vector ID (Email)</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full rounded-2xl border border-[#2a2a2a] bg-[#0D0D0D] px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-[#f97316]/50 focus:border-[#f97316] text-white placeholder-[#333] transition-all"
              placeholder="you@example.com"
            />
          </div>

          {/* Password */}
          <div className="space-y-2">
            <label htmlFor="password" className="block text-[10px] font-black text-[#666666] uppercase tracking-widest italic ml-1">Access Key</label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full rounded-2xl border border-[#2a2a2a] bg-[#0D0D0D] px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-[#f97316]/50 focus:border-[#f97316] text-white placeholder-[#333] transition-all"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[#666] hover:text-[#f97316] transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {/* Strength Indicator */}
            <div className="mt-3 px-1">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-[8px] font-black text-[#666] uppercase tracking-widest italic">Signal Strength</span>
                <span className={`text-[8px] font-black uppercase italic ${
                  strength >= 4 ? 'text-emerald-500' :
                  strength >= 3 ? 'text-blue-500' :
                  strength >= 2 ? 'text-yellow-500' :
                  strength >= 1 ? 'text-red-500' : 'text-[#333]'
                }`}>
                  {strength >= 4 ? 'Optimal' : strength >= 3 ? 'Strong' : strength >= 2 ? 'Fair' : strength >= 1 ? 'Weak' : 'None'}
                </span>
              </div>
              <div className="h-1 w-full bg-[#1E1E1E] rounded-full overflow-hidden flex gap-1">
                {[1, 2, 3, 4].map((step) => (
                  <div
                    key={step}
                    className={`h-full flex-1 transition-all duration-500 ${
                      strength >= step ? (
                        strength >= 4 ? 'bg-emerald-500' :
                        strength >= 3 ? 'bg-blue-500' :
                        strength >= 2 ? 'bg-yellow-500' :
                        'bg-red-500'
                      ) : 'bg-[#2a2a2a]'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Confirm Password */}
          <div className="space-y-2">
            <label htmlFor="confirm" className="block text-[10px] font-black text-[#666666] uppercase tracking-widest italic ml-1">Verify Key</label>
            <input
              id="confirm"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              className="w-full rounded-2xl border border-[#2a2a2a] bg-[#0D0D0D] px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-[#f97316]/50 focus:border-[#f97316] text-white placeholder-[#333] transition-all"
              placeholder="••••••••"
            />
          </div>

          {error && <div className="text-red-500 text-[10px] font-black uppercase tracking-widest italic animate-pulse">{error}</div>}
          {success && <div className="text-emerald-500 text-[10px] font-black uppercase tracking-widest italic">{success}</div>}

          {/* Primary Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl text-white font-black text-[10px] uppercase tracking-[0.2em] bg-[#f97316] hover:opacity-90 transition-all shadow-xl shadow-[#f97316]/20 border-b-4 border-[#ae3207] active:border-b-0 active:translate-y-1 disabled:opacity-50 italic"
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                Create Account
                <UserPlus className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="my-8 flex items-center px-4">
          <div className="flex-grow h-px bg-[#2a2a2a]" />
          <span className="mx-4 text-[9px] font-black text-[#666] uppercase tracking-[0.3em] italic">Secondary Auth</span>
          <div className="flex-grow h-px bg-[#2a2a2a]" />
        </div>

        {/* Social Buttons */}
        <SocialLoginButtons />

        <p className="mt-10 text-center text-[10px] font-black uppercase tracking-widest italic text-[#666]">
          Already active operative?{' '}
          <a href="/login" className="text-[#f97316] hover:underline decoration-2 underline-offset-4 decoration-[#f97316]/30 transition-all">
            Initiate Session
          </a>
        </p>
      </div>
    </ModernAuthLayout>
  );
}
