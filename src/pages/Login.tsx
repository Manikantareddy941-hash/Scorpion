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
      heading="Get access your personal hub for clarity and productivity"
      subtext="Clarity. Security. Productivity."
    >
      <div className="w-full max-w-sm mx-auto">
        <h1 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">
          Create an account
        </h1>

        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Access your dashboard securely and manage everything in one place.
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
              className="w-full rounded-xl border border-gray-300 dark:border-neutral-700 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:bg-neutral-800 text-gray-900 dark:text-white"
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
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full rounded-xl border border-gray-300 dark:border-neutral-700 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:bg-neutral-800 text-gray-900 dark:text-white"
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
          </div>

          {error && <div className="text-red-500 text-xs mt-1">{error}</div>}

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
                <LogIn className="w-4 h-4" />
                Get Started
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
          Don't have an account?{' '}
          <a href="/signup" className="text-purple-600 hover:text-purple-500 font-semibold transition-colors">
            Sign up
          </a>
        </p>
      </div>
    </ModernAuthLayout>
  );
}
