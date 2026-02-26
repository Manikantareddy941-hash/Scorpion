import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { LogIn, UserPlus, AlertCircle, CheckCircle2, ArrowLeft, Mail } from 'lucide-react';
import AuthDiagnosticBanner from './AuthDiagnosticBanner';
import { authHealthCheck, AuthHealthResult } from '../lib/authHealthCheck';

export default function Auth() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<AuthHealthResult | null>(null);
  const { signIn, signUp, requestReset } = useAuth();

  const clearMessages = () => {
    setError('');
    setSuccess('');
    setHealth(null);
  };

  const switchMode = (newMode: 'login' | 'signup' | 'forgot') => {
    setMode(newMode);
    clearMessages();
  };

  const runDiagnostics = async () => {
    const healthResult = await authHealthCheck();
    if (!healthResult.backendReachable || !healthResult.supabaseReachable) {
      setHealth(healthResult);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    setLoading(true);

    try {
      if (mode === 'forgot') {
        const { error, message } = await requestReset(email);
        if (error) {
          setError(error);
          await runDiagnostics();
        } else {
          setSuccess(message || 'OTP sent! Redirecting...');
          setTimeout(() => navigate('/verify-otp', { state: { email } }), 1500);
        }
      } else {
        const { error } = mode === 'login'
          ? await signIn(email, password)
          : await signUp(email, password);

        if (error) {
          setError(error.message);
          await runDiagnostics();
        } else if (mode === 'signup') {
          setSuccess('Account created! Please check your email to verify, then sign in.');
          switchMode('login');
        }
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
      await runDiagnostics();
    } finally {
      setLoading(false);
    }
  };

  const getIcon = () => {
    if (mode === 'forgot') return <Mail className="w-8 h-8 text-white" />;
    if (mode === 'login') return <LogIn className="w-8 h-8 text-white" />;
    return <UserPlus className="w-8 h-8 text-white" />;
  };

  const getTitle = () => {
    if (mode === 'forgot') return 'Reset Password';
    if (mode === 'login') return 'Welcome back!';
    return 'Create your account';
  };

  const getButtonLabel = () => {
    if (mode === 'forgot') return 'Send Reset Code';
    if (mode === 'login') return 'Sign In';
    return 'Sign Up';
  };

  const getButtonIcon = () => {
    if (mode === 'forgot') return <Mail className="w-5 h-5" />;
    if (mode === 'login') return <LogIn className="w-5 h-5" />;
    return <UserPlus className="w-5 h-5" />;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4">
            {getIcon()}
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            DevOps Task Tracker
          </h1>
          <p className="text-gray-600 dark:text-gray-300">{getTitle()}</p>
          {mode === 'forgot' && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              Enter your email and we'll send you a 6-digit code.
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {health && <AuthDiagnosticBanner health={health} />}

          {success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-green-800">{success}</p>
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
              placeholder="you@example.com"
            />
          </div>

          {mode !== 'forgot' && (
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                placeholder="••••••••"
              />
            </div>
          )}

          {mode === 'login' && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Forgot password?
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-3 rounded-lg transition duration-200 flex items-center justify-center gap-2"
          >
            {loading ? (
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Please wait...</span>
              </div>
            ) : (
              <>
                {getButtonIcon()}
                {getButtonLabel()}
              </>
            )}
          </button>
        </form>

        <div className="mt-6 text-center space-y-2">
          {mode === 'forgot' ? (
            <button
              onClick={() => switchMode('login')}
              className="text-blue-600 hover:text-blue-700 font-medium text-sm inline-flex items-center gap-1 mx-auto"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Sign In
            </button>
          ) : (
            <button
              onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
              className="text-blue-600 hover:text-blue-700 font-medium text-sm"
            >
              {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
