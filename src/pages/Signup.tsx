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
      heading="Build and deploy with confidence and security"
      subtext="Modern DevOps, Secure by Default."
    >
      <div className="w-full max-w-sm mx-auto">
        <h1 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">
          Join StackPilot
        </h1>

        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Start your journey with a secure-by-default environment.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email */}
          <div>
            <label htmlFor="email" className="block text-sm mb-1 font-medium text-gray-700 dark:text-gray-300">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full rounded-xl border border-gray-300 dark:border-neutral-700 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:bg-neutral-800 text-gray-900 dark:text-white transition-all"
              placeholder="you@example.com"
            />
          </div>

          {/* Password */}
          <div>
            <label htmlFor="password" className="block text-sm mb-1 font-medium text-gray-700 dark:text-gray-300">Password</label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full rounded-xl border border-gray-300 dark:border-neutral-700 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:bg-neutral-800 text-gray-900 dark:text-white transition-all"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {/* Strength Indicator */}
            <div className="mt-2 h-1.5 w-full bg-gray-200 dark:bg-neutral-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${strength === 0 ? 'w-0' :
                  strength === 1 ? 'w-1/4 bg-red-500' :
                    strength === 2 ? 'w-2/4 bg-yellow-500' :
                      strength === 3 ? 'w-3/4 bg-blue-500' :
                        'w-full bg-emerald-500'
                  }`}
              />
            </div>
          </div>

          {/* Confirm Password */}
          <div>
            <label htmlFor="confirm" className="block text-sm mb-1 font-medium text-gray-700 dark:text-gray-300">Confirm Password</label>
            <input
              id="confirm"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              className="w-full rounded-xl border border-gray-300 dark:border-neutral-700 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:bg-neutral-800 text-gray-900 dark:text-white transition-all"
              placeholder="••••••••"
            />
          </div>

          {error && <div className="text-red-500 text-xs mt-1">{error}</div>}
          {success && <div className="text-emerald-600 dark:text-emerald-400 text-xs mt-1 font-medium">{success}</div>}

          {/* Primary Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-white font-medium bg-gradient-to-r from-blue-600 via-purple-600 to-pink-500 hover:opacity-90 transition shadow-md disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                Sign up
              </>
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="my-6 flex items-center">
          <div className="flex-grow h-px bg-gray-300 dark:bg-neutral-700" />
          <span className="mx-3 text-xs text-gray-400">or continue with</span>
          <div className="flex-grow h-px bg-gray-300 dark:bg-neutral-700" />
        </div>

        {/* Social Buttons */}
        <div className="mt-4">
          <SocialLoginButtons />
        </div>

        <p className="mt-8 text-center text-sm text-gray-500 dark:text-gray-400">
          Already have an account?{' '}
          <a href="/login" className="text-purple-600 hover:text-purple-500 font-semibold transition-colors">
            Sign in
          </a>
        </p>
      </div>
    </ModernAuthLayout>
  );
}
