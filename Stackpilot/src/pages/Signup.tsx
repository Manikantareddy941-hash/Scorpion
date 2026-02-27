import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { UserPlus, Eye, EyeOff } from 'lucide-react';
import AuthLayout from '../components/auth/AuthLayout';

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
    <AuthLayout headline="Create your StackPilot account" subtext="Modern DevOps, Secure by Default.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 mb-2">Sign up</h2>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#020617] px-4 py-3 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all duration-200"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#020617] px-4 py-3 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all duration-200 pr-12"
              placeholder="••••••••"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200 transition-all"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          <div className="mt-2 h-2 w-full bg-neutral-200 dark:bg-neutral-800 rounded">
            <div
              className={`h-2 rounded transition-all duration-200 ${strength === 0 ? 'w-0' : strength === 1 ? 'w-1/4 bg-red-400' : strength === 2 ? 'w-2/4 bg-yellow-400' : strength === 3 ? 'w-3/4 bg-blue-400' : 'w-full bg-green-500'}`}
            />
          </div>
        </div>
        <div>
          <label htmlFor="confirm" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm Password</label>
          <input
            id="confirm"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
            className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#020617] px-4 py-3 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all duration-200"
            placeholder="••••••••"
          />
        </div>
        {error && <div className="text-red-600 text-sm mt-1">{error}</div>}
        {success && <div className="text-green-600 text-sm mt-1">{success}</div>}
        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 hover:brightness-110 text-white font-semibold py-3 mt-2 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed shadow"
        >
          {loading ? (
            <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <UserPlus className="w-5 h-5" />
          )}
          Sign up
        </button>
        <div className="flex items-center my-4">
          <div className="flex-grow border-t border-neutral-200 dark:border-neutral-700" />
          <span className="mx-3 text-xs text-gray-400 uppercase tracking-widest">or continue with</span>
          <div className="flex-grow border-t border-neutral-200 dark:border-neutral-700" />
        </div>
        <div className="flex gap-3">
          <button type="button" className="flex-1 flex items-center justify-center gap-2 border border-neutral-200 dark:border-neutral-700 rounded-lg py-2 px-4 font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-[#020617] hover:bg-gray-50 dark:hover:bg-slate-800 transition-all duration-200" disabled>
            {/* Google Icon */}
            <span className="w-5 h-5 bg-gradient-to-br from-indigo-400 to-purple-400 rounded-full mr-2" />
            Google
          </button>
          <button type="button" className="flex-1 flex items-center justify-center gap-2 border border-neutral-200 dark:border-neutral-700 rounded-lg py-2 px-4 font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-[#020617] hover:bg-gray-50 dark:hover:bg-slate-800 transition-all duration-200" disabled>
            {/* GitHub Icon */}
            <span className="w-5 h-5 bg-gradient-to-br from-gray-700 to-gray-900 rounded-full mr-2" />
            GitHub
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
