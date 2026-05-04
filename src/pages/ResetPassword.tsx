import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { KeyRound, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ModernAuthLayout from '../components/auth/ModernAuthLayout';
import AuthDiagnosticBanner from '../components/AuthDiagnosticBanner';
import { authHealthCheck, AuthHealthResult } from '../lib/authHealthCheck';

export default function ResetPassword() {
    const { t } = useTranslation();
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
            setError(t('auth.invalid_session', 'Invalid or expired reset session. Please start over.'));
        }
    }, [resetToken, t]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setHealth(null);

        if (!resetToken) {
            setError(t('auth.missing_token', 'Missing reset token. Please request a new code.'));
            return;
        }

        if (password !== confirmPassword) {
            setError(t('auth.passwords_not_match', 'Passwords do not match.'));
            return;
        }

        if (password.length < 6) {
            setError(t('auth.password_min_length', 'Password must be at least 6 characters.'));
            return;
        }

        setLoading(true);

        const runDiagnostics = async () => {
            const healthResult = await authHealthCheck();
            if (!healthResult.backendReachable || !healthResult.appwriteReachable) {
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
                setTimeout(() => navigate('/login'), 3000);
            }
        } catch (err) {
            setError(t('auth.unexpected_error', 'An unexpected error occurred.'));
            await runDiagnostics();
        } finally {
            setLoading(false);
        }
    };

    return (
        <ModernAuthLayout subtext={t('auth.security_override', 'Security Override')}>
            <div className="w-full">
                <h1 className="text-xl font-black mb-1 text-[var(--text-primary)] uppercase italic tracking-tight">
                    {t('auth.credential_reset', 'Credential Reset')}
                </h1>
                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.15em] mb-8 italic">
                    {t('auth.establish_new_params', 'Establish new access parameters for your identity.')}
                </p>

                {success ? (
                    <div className="bg-[var(--status-success)]/10 border border-[var(--status-success)]/20 rounded-2xl p-6 text-center">
                        <CheckCircle2 className="w-12 h-12 text-[var(--status-success)] mx-auto mb-3" />
                        <p className="text-[var(--status-success)] font-black uppercase italic text-sm tracking-widest">{t('auth.protocol_restored', 'Protocol Restored')}</p>
                        <p className="text-[var(--text-secondary)] text-[10px] font-bold uppercase mt-2 italic tracking-widest">{t('auth.redirecting_to_login', 'Redirecting to login sequence...')}</p>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {error && (
                            <div className="bg-[var(--status-error)]/10 border border-[var(--status-error)]/20 rounded-xl p-4 flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-[var(--status-error)] flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-[var(--status-error)] font-bold uppercase tracking-tight italic">{error}</p>
                            </div>
                        )}
                        
                        {health && <AuthDiagnosticBanner health={health} />}

                        {!resetToken ? (
                            <button
                                type="button"
                                onClick={() => navigate('/forgot-password')}
                                className="w-full bg-[var(--status-error)] text-white font-black text-[10px] py-4 rounded-2xl uppercase tracking-widest italic"
                            >
                                {t('auth.request_new_code', 'Request New Code')}
                            </button>
                        ) : (
                            <>
                                <div className="space-y-2">
                                    <label htmlFor="new-password" className="block text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic ml-1">{t('auth.new_access_key', 'New Access Key')}</label>
                                    <input
                                        id="new-password"
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        minLength={6}
                                        className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50 focus:border-[var(--accent-primary)] text-[var(--text-primary)] placeholder-[var(--text-secondary)] transition-all"
                                        placeholder={t('auth.password_placeholder', '••••••••')}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label htmlFor="confirm-password" className="block text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic ml-1">{t('auth.verify_new_key', 'Verify New Key')}</label>
                                    <input
                                        id="confirm-password"
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        required
                                        minLength={6}
                                        className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50 focus:border-[var(--accent-primary)] text-[var(--text-primary)] placeholder-[var(--text-secondary)] transition-all"
                                        placeholder={t('auth.password_placeholder', '••••••••')}
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
                                            {t('auth.update_access_key', 'Update Access Key')}
                                            <KeyRound className="w-4 h-4" />
                                        </>
                                    )}
                                </button>
                            </>
                        )}
                    </form>
                )}
            </div>
        </ModernAuthLayout>
    );
}
