import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { KeyRound, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';

export default function VerifyOtp() {
    const [otp, setOtp] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const { verifyResetOtp } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const email = location.state?.email || '';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (otp.length !== 6) {
            setError('Please enter a valid 6-digit code.');
            return;
        }

        setError('');
        setLoading(true);

        try {
            const { error, resetToken } = await verifyResetOtp(email, otp);
            if (error) {
                setError(error);
            } else {
                // Success: Redirect to actual reset page with token
                navigate('/reset-password', { state: { email, resetToken } });
            }
        } catch (err) {
            setError('An unexpected error occurred.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-8">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4">
                        <KeyRound className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Enter Code</h1>
                    <p className="text-gray-600 dark:text-gray-300">We've sent a 6-digit code to <span className="font-semibold text-gray-900 dark:text-white">{email}</span></p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-red-800">{error}</p>
                        </div>
                    )}

                    <div>
                        <label htmlFor="otp" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Verification Code
                        </label>
                        <input
                            id="otp"
                            type="text"
                            maxLength={6}
                            value={otp}
                            onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ''))}
                            required
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition text-center text-2xl tracking-[10px] font-bold"
                            placeholder="000000"
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
                            'Verify Code'
                        )}
                    </button>
                </form>

                <div className="mt-8 pt-6 border-t border-gray-100 text-center">
                    <Link to="/forgot-password" className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium transition text-sm">
                        <ArrowLeft className="w-4 h-4" />
                        Resend Code
                    </Link>
                </div>
            </div>
        </div>
    );
}



