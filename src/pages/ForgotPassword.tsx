import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import AuthDiagnosticBanner from '../components/AuthDiagnosticBanner';
import { authHealthCheck, AuthHealthResult } from '../lib/authHealthCheck';

export default function ForgotPassword() {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [health, setHealth] = useState<AuthHealthResult | null>(null);
    const { requestReset } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setHealth(null);
        setLoading(true);

        const runDiagnostics = async () => {
            const healthResult = await authHealthCheck();
            if (!healthResult.backendReachable || !healthResult.supabaseReachable) {
                setHealth(healthResult);
            }
        };

        try {
            const { error } = await requestReset(email);
            if (error) {
                setError(error);
                await runDiagnostics();
            } else {
                // Success: Redirect to OTP verification page
                navigate('/verify-otp', { state: { email } });
            }
        } catch (err) {
            setError('An unexpected error occurred.');
            await runDiagnostics();
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-8">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4">
                        <Mail className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Forgot Password</h1>
                    <p className="text-gray-600 dark:text-gray-300">Enter your email and we'll send you a 6-digit code to reset your password.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-red-800">{error}</p>
                        </div>
                    )}

                    {health && <AuthDiagnosticBanner health={health} />}

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

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-3 rounded-lg transition duration-200 flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            'Send Reset Code'
                        )}
                    </button>
                </form>

                <div className="mt-8 pt-6 border-t border-gray-100 text-center">
                    <Link to="/auth" className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium transition">
                        <ArrowLeft className="w-4 h-4" />
                        Back to Login
                    </Link>
                </div>
            </div>
        </div>
    );
}




