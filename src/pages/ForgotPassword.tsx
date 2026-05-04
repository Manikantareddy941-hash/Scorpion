import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, AlertCircle, Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ModernAuthLayout from '../components/auth/ModernAuthLayout';

export default function ForgotPassword() {
    const { t } = useTranslation();
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const { requestReset } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const { error } = await requestReset(email);
            if (error) {
                if (error.toLowerCase().includes('fetch') || error.toLowerCase().includes('network')) {
                    setError(t('auth.working_on_it', 'Working on it... Please wait.'));
                } else {
                    setError(error);
                }
            } else {
                navigate('/verify-otp', { state: { email } });
            }
        } catch (err: any) {
            setError(t('auth.unexpected_error', 'An unexpected error occurred.'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <ModernAuthLayout subtext={t('auth.secure_recovery', 'Secure Identity Recovery')}>
            <div className="w-full">
                <h1 className="text-xl font-black mb-1 text-[var(--text-primary)] uppercase italic tracking-tight">
                    {t('auth.reset_access', 'Reset Access')}
                </h1>
                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.15em] mb-8 italic">
                    {t('auth.enter_vector_id_desc', 'Enter vector ID to initiate recovery sequence.')}
                </p>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {error && (
                        <div className="bg-[var(--status-error)]/10 border border-[var(--status-error)]/20 rounded-xl p-4 flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-[var(--status-error)] flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-[var(--status-error)] font-bold uppercase tracking-tight italic">{error}</p>
                        </div>
                    )}

                    <div className="space-y-2">
                        <label htmlFor="email" className="block text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic ml-1">{t('auth.vector_id_label', 'Vector ID (Email)')}</label>
                        <input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50 focus:border-[var(--accent-primary)] text-[var(--text-primary)] placeholder-[var(--text-secondary)] transition-all"
                            placeholder={t('auth.forgot_password_placeholder', 'operator@scorpion.secure')}
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
                                {t('auth.send_recovery_code', 'Send Recovery Code')}
                                <Mail className="w-4 h-4" />
                            </>
                        )}
                    </button>
                </form>

                <div className="mt-8 pt-6 border-t border-[var(--border-subtle)] text-center">
                    <Link to="/login" className="inline-flex items-center gap-2 text-[var(--accent-primary)] hover:underline font-black text-[10px] uppercase tracking-widest italic transition">
                        <ArrowLeft className="w-4 h-4" />
                        {t('auth.return_to_uplink', 'Return to Uplink')}
                    </Link>
                </div>
            </div>
        </ModernAuthLayout>
    );
}




