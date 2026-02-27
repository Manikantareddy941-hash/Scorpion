import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { KeyRound, AlertCircle, CheckCircle2 } from 'lucide-react';
import AuthDiagnosticBanner from '../components/AuthDiagnosticBanner';
import { authHealthCheck, AuthHealthResult } from '../lib/authHealthCheck';

export default function ResetPassword() {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [loading, setLoading] = useState(false);
    const [health, setHealth] = useState<AuthHealthResult | null>(null);
    const { completeReset } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const resetToken = location.state?.resetToken || '';

    useEffect(() => {
        if (!resetToken) {
            setError('Invalid or expired reset session. Please start over.');
        }
    }, [resetToken]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setHealth(null);

        if (!resetToken) {
            setError('Missing reset token. Please request a new code.');
            return;
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }

        if (password.length < 6) {
            setError('Password must be at least 6 characters.');
            return;
        }

        setLoading(true);

        const runDiagnostics = async () => {
            const healthResult = await authHealthCheck();
            if (!healthResult.backendReachable || !healthResult.supabaseReachable) {
                setHealth(healthResult);
            }
        };

        try {
            const { error } = await completeReset(resetToken, password);
            if (error) {
                setError(error);
                await runDiagnostics();
            } else {
                setSuccess(true);
                setTimeout(() => navigate('/auth'), 3000);
            }
        } catch (err) {
            setError('An unexpected error occurred.');
            await runDiagnostics();
        } finally {
            setLoading(false);
        }
    };

    if (!resetToken && !success) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-800/50 flex items-center justify-center p-4">
                <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-md p-8 text-center">
                    <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Invalid Session</h1>
                    <p className="text-gray-600 dark:text-gray-300 mb-6">Your reset session has expired or is invalid. Please request a new code.</p>
                    <button
                        onClick={() => navigate('/forgot-password')}
                        className="w-full bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-700 transition"
                    >
                        Request New Code
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-8">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4">
                        <KeyRound className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                        Set New Password
                    </h1>
                    <p className="text-gray-600 dark:text-gray-300">
                        Enter your new password below.
                    </p>
                </div>

                {success ? (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
                        <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-3" />
                        <p className="text-green-800 font-semibold text-lg">Password Updated!</p>
                        <p className="text-green-700 text-sm mt-1">Redirecting to login...</p>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {error && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                                <p className="text-sm text-red-800">{error}</p>
                            </div>
                        )}
                        
                        {health && <AuthDiagnosticBanner health={health} />}

                        <div>
                            <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                New Password
                            </label>
                            <input
                                id="new-password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                minLength={6}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                                placeholder="••••••••"
                            />
                        </div>

                        <div>
                            <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Confirm Password
                            </label>
                            <input
                                id="confirm-password"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                                minLength={6}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                                placeholder="••••••••"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-3 rounded-lg transition duration-200 flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <span>Loading...</span>
                            ) : (
                                <>
                                    <KeyRound className="w-5 h-5" />
                                    Update Password
                                </>
                            )}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
