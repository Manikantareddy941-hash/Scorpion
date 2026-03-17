import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import ModernAuthLayout from '../components/auth/ModernAuthLayout';
import SocialLoginButtons from '../components/auth/SocialLoginButtons';

export default function Login() {
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
    if (error) setError(error.message || 'Invalid credentials');
    setLoading(false);
  };

  return (
    <ModernAuthLayout
      subtext="Clarity. Security. Productivity."
    >
      <div className="w-full">
        <h1 className="text-xl font-black mb-1 text-white uppercase italic tracking-tight">
          Operator Login
        </h1>

        <p className="text-[10px] font-bold text-[#666666] uppercase tracking-[0.15em] mb-8 italic">
          Authorized personnel only. Data stream encrypted.
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
              placeholder="operator@scorpion.secure"
            />
          </div>

          {/* Password */}
          <div className="space-y-2">
            <label htmlFor="password" className="block text-[10px] font-black text-[#666666] uppercase tracking-widest italic ml-1">Access Key</label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
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
          </div>

          {error && <div className="text-red-500 text-[10px] font-black uppercase tracking-widest italic animate-pulse">{error}</div>}

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
                Initialize Session
                <LogIn className="w-4 h-4" />
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
          New operative?{' '}
          <a href="/signup" className="text-[#f97316] hover:underline decoration-2 underline-offset-4 decoration-[#f97316]/30 transition-all">
            Request Access
          </a>
        </p>
      </div>
    </ModernAuthLayout>
  );
}
