import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import AuthDiagnosticBanner from './AuthDiagnosticBanner';
import SocialLoginButtons from './auth/SocialLoginButtons';

export default function Auth() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signUp, requestReset } = useAuth();

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  const switchMode = (newMode: 'login' | 'signup' | 'forgot') => {
    setMode(newMode);
    setEmail('');
    setPassword('');
    setShowPassword(false);
    clearMessages();
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
        } else {
          setSuccess(message || 'OTP sent! Redirecting...');
          setTimeout(() => navigate('/verify-otp', { state: { email } }), 1500);
        }
      } else {
        const { error } = mode === 'login'
          ? await signIn(email, password)
          : await signUp(email, password);

        if (error) {
          setError(error.message || 'Authentication failed');
        } else if (mode === 'signup') {
          setSuccess('Account created! Please check your email to verify, then sign in.');
          switchMode('login');
        }
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const getButtonLabel = () => {
    if (mode === 'forgot') return 'Send Reset Code';
    if (mode === 'login') return 'Sign in';
    return 'Create account';
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 animate-fade-up">
      <div className="w-full max-w-[400px]">
        <div className="text-center mb-10">
          <div className="logo-mark !w-10 !h-10 mx-auto mb-6 !text-[15px]">SP</div>
          <h1 className="text-[32px] font-normal tracking-tight mb-2">
            {mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create account' : 'Reset password'}
          </h1>
          <p className="text-[14.5px] text-text-muted">
            {mode === 'login' ? 'Enter your details to access your pilot.' :
              mode === 'signup' ? 'Start your journey with StackPilot today.' :
                'Enter your email to receive a reset code.'}
          </p>
        </div>

        <div className="card shadow-sm border-border">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-danger-light border border-danger/10 rounded-md p-3.5 flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />
                <p className="text-[12.5px] text-danger font-medium leading-relaxed">{error}</p>
              </div>
            )}

            {success && (
              <div className="bg-success-light border border-success/10 rounded-md p-3.5 flex items-start gap-3">
                <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0 mt-0.5" />
                <p className="text-[12.5px] text-success font-medium leading-relaxed">{success}</p>
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-[13px] font-medium text-text-muted mb-2">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 bg-surface border border-border rounded-md text-[14px] outline-none focus:border-accent transition-colors placeholder:text-text-subtle"
                placeholder="name@company.com"
              />
            </div>

            {mode !== 'forgot' && (
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label htmlFor="password" className="block text-[13px] font-medium text-text-muted">
                    Password
                  </label>
                  {mode === 'login' && (
                    <button
                      type="button"
                      onClick={() => switchMode('forgot')}
                      className="text-[12px] text-accent hover:underline font-medium"
                    >
                      Forgot?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="w-full px-3.5 py-2.5 bg-surface border border-border rounded-md text-[14px] outline-none focus:border-accent transition-colors placeholder:text-text-subtle"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-subtle hover:text-text transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center !py-2.5 !text-[14px] h-[42px]"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                getButtonLabel()
              )}
            </button>
          </form>

          {mode !== 'forgot' && (
            <div className="mt-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="flex-grow h-px bg-border" />
                <span className="text-[10px] text-text-subtle uppercase tracking-widest font-semibold">Or continue with</span>
                <div className="flex-grow h-px bg-border" />
              </div>
              <SocialLoginButtons />
            </div>
          )}
        </div>

        <div className="mt-8 text-center">
          {mode === 'forgot' ? (
            <button
              onClick={() => switchMode('login')}
              className="text-accent hover:underline font-medium text-[13px] inline-flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Return to login
            </button>
          ) : (
            <p className="text-[13px] text-text-muted">
              {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
              <button
                onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
                className="text-accent hover:underline font-medium"
              >
                {mode === 'login' ? 'Sign up' : 'Sign in'}
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
