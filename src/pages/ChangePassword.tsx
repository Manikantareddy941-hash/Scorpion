import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { KeyRound, AlertCircle, CheckCircle2, ArrowLeft, Loader2 } from 'lucide-react';
import ModernAuthLayout from '../components/auth/ModernAuthLayout';

export default function ChangePassword() {
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [loading, setLoading] = useState(false);
    const { updatePassword } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (newPassword !== confirmPassword) {
            setError('New passwords do not match.');
            return;
        }

        if (newPassword.length < 6) {
            setError('Password must be at least 6 characters.');
            return;
        }

        setLoading(true);

        try {
            const { error } = await updatePassword(newPassword);
            if (error) {
                setError(error.message);
            } else {
                setSuccess(true);
                setTimeout(() => navigate('/'), 2000);
            }
        } catch (err) {
            setError('An unexpected error occurred.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <ModernAuthLayout subtext="Account Security">
            <div className="w-full">
                <h1 className="text-xl font-black mb-1 text-[var(--text-primary)] uppercase italic tracking-tight">
                    Credential Update
                </h1>
                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.15em] mb-8 italic">
                    Configure new access tokens for your account.
                </p>

                {success ? (
                    <div className="bg-[var(--status-success)]/10 border border-[var(--status-success)]/20 rounded-2xl p-6 text-center">
                        <CheckCircle2 className="w-12 h-12 text-[var(--status-success)] mx-auto mb-3" />
                        <p className="text-[var(--status-success)] font-black uppercase italic text-sm tracking-widest">Update Applied</p>
                        <p className="text-[var(--text-secondary)] text-[10px] font-bold uppercase mt-2 italic tracking-widest">Redirecting to home base...</p>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {error && (
                            <div className="bg-[var(--status-error)]/10 border border-[var(--status-error)]/20 rounded-xl p-4 flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-[var(--status-error)] flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-[var(--status-error)] font-bold uppercase tracking-tight italic">{error}</p>
                            </div>
                        )}

                        <div className="space-y-2">
                            <label htmlFor="new-password" className="block text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic ml-1">New Access Key</label>
                            <input
                                id="new-password"
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                required
                                minLength={6}
                                className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50 focus:border-[var(--accent-primary)] text-[var(--text-primary)] placeholder-[var(--text-secondary)] transition-all"
                                placeholder="••••••••"
                            />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="confirm-password" className="block text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic ml-1">Verify New Key</label>
                            <input
                                id="confirm-password"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                                minLength={6}
                                className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50 focus:border-[var(--accent-primary)] text-[var(--text-primary)] placeholder-[var(--text-secondary)] transition-all"
                                placeholder="••••••••"
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
                                    Update Access Key
                                    <KeyRound className="w-4 h-4" />
                                </>
                            )}
                        </button>
                    </form>
                )}

                <div className="mt-8 pt-6 border-t border-[var(--border-subtle)] text-center">
                    <Link to="/" className="inline-flex items-center gap-2 text-[var(--accent-primary)] hover:underline font-black text-[10px] uppercase tracking-widest italic transition">
                        <ArrowLeft className="w-4 h-4" />
                        Back to Command Center
                    </Link>
                </div>
            </div>
        </ModernAuthLayout>
    );
}



