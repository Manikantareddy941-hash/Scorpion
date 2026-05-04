import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { KeyRound, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ModernAuthLayout from '../components/auth/ModernAuthLayout';

export default function VerifyOtp() {
    const { t } = useTranslation();
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
            setError(t('auth.invalid_otp', 'Please enter a valid 6-digit code.'));
            return;
        }

        setError('');
        setLoading(true);

        try {
            const { error, resetToken } = await verifyResetOtp(email, otp);
            if (error) {
                setError(error);
            } else {
                navigate('/reset-password', { state: { email, resetToken } });
            }
        } catch (err) {
            setError(t('auth.unexpected_error', 'An unexpected error occurred.'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <ModernAuthLayout subtext={t('auth.identity_verification', 'Identity Verification')}>
            <div className="w-full">
                <h1 className="text-xl font-black mb-1 text-[var(--text-primary)] uppercase italic tracking-tight">
                    {t('auth.verify_vector', 'Verify Vector')}
                </h1>
                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.15em] mb-8 italic">
                    {t('auth.transmission_sent_to', { email: email, defaultValue: `Transmission sent to ${email}.` })}
                </p>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {error && (
                        <div className="bg-[var(--status-error)]/10 border border-[var(--status-error)]/20 rounded-xl p-4 flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-[var(--status-error)] flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-[var(--status-error)] font-bold uppercase tracking-tight italic">{error}</p>
                        </div>
                    )}

                    <div className="space-y-2">
                        <label htmlFor="otp" className="block text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic ml-1">{t('auth.transmission_code', 'Transmission Code')}</label>
                        <input
                            id="otp"
                            type="text"
                            maxLength={6}
                            value={otp}
                            onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ''))}
                            required
                            className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-5 py-4 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50 focus:border-[var(--accent-primary)] text-[var(--text-primary)] text-center text-3xl tracking-[12px] font-black transition-all placeholder-[var(--text-secondary)]/20"
                            placeholder={t('auth.otp_placeholder', '000000')}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] bg-[var(--accent-primary)] hover:opacity-90 transition-all shadow-xl shadow-[var(--accent-primary)]/20 border-b-4 border-[var(--accent-secondary)] active:border-b-0 active:translate-y-1 disabled:opacity-50 italic text-white"
                    >
                        {loading ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            <>
                                {t('auth.authenticate_vector', 'Authenticate Vector')}
                                <KeyRound className="w-4 h-4" />
                            </>
                        )}
                    </button>
                </form>

                <div className="mt-8 pt-6 border-t border-[var(--border-subtle)] text-center">
                    <Link to="/forgot-password" className="inline-flex items-center gap-2 text-[var(--accent-primary)] hover:underline font-black text-[10px] uppercase tracking-widest italic transition">
                        <ArrowLeft className="w-4 h-4" />
                        {t('auth.resend_transmission', 'Resend Transmission')}
                    </Link>
                </div>
            </div>
        </ModernAuthLayout>
    );
}



