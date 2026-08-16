import { useState } from 'react';
import { account } from '../lib/appwrite';
import { useAuth } from '../contexts/AuthContext';

/**
 * Soft enforcement for unverified accounts.
 *
 * The backend gates only the high-risk actions (CI token creation, team
 * invites, alert integrations, report export) with requireEmailVerification and
 * answers 403 { code: 'EMAIL_VERIFICATION_REQUIRED' }. The dashboard itself
 * stays open, so without this banner an unverified user's first sign that
 * anything is wrong would be a failed action.
 *
 * Dismissible per session rather than persisted: the condition resolves itself
 * the moment the user clicks the link in their inbox, and a dismissal stored
 * across sessions would hide a state the account is still actually in.
 */
export default function EmailVerificationBanner() {
    const { user } = useAuth();
    const [dismissed, setDismissed] = useState(false);
    const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

    // Strictly `false`, not falsy. An OAuth user arrives already verified, and a
    // user object that has not loaded yet must not flash the banner.
    if (dismissed || user?.emailVerification !== false) return null;

    const resend = async () => {
        setStatus('sending');
        try {
            await account.createVerification(`${window.location.origin}/verify-email`);
            setStatus('sent');
        } catch {
            // Self-hosted installs with no SMTP land here, which is exactly why
            // enforcement is soft: such a user cannot become verified at all, so
            // the failure is surfaced rather than retried into a loop.
            setStatus('failed');
        }
    };

    return (
        <div
            role="status"
            className="flex flex-wrap items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200"
        >
            <span className="flex-1 min-w-[16rem]">
                {status === 'sent'
                    ? 'Verification email sent — check your inbox.'
                    : status === 'failed'
                        ? 'Could not send the verification email. Your server may not have email configured.'
                        : 'Verify your email address to create API tokens, invite teammates, configure alerts, or export reports.'}
            </span>

            {status !== 'sent' && (
                <button
                    type="button"
                    onClick={resend}
                    disabled={status === 'sending'}
                    className="rounded border border-amber-400/40 px-2 py-1 font-medium hover:bg-amber-500/20 disabled:opacity-60"
                >
                    {status === 'sending' ? 'Sending…' : 'Resend link'}
                </button>
            )}

            <button
                type="button"
                onClick={() => setDismissed(true)}
                aria-label="Dismiss"
                className="rounded px-2 py-1 hover:bg-amber-500/20"
            >
                ✕
            </button>
        </div>
    );
}
