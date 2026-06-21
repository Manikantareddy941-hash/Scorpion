import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { account } from '../lib/appwrite';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

type Status = 'verifying' | 'success' | 'error';

// Handles the link Appwrite emails on signup: it redirects here with userId +
// secret query params, which we exchange via account.updateVerification.
export default function VerifyEmail() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>('verifying');
  const [message, setMessage] = useState('Confirming your email address…');

  useEffect(() => {
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const userId = params.get('userId');
      const secret = params.get('secret');

      if (!userId || !secret) {
        setStatus('error');
        setMessage('This verification link is missing required information.');
        return;
      }

      try {
        await account.updateVerification(userId, secret);
        setStatus('success');
        setMessage('Your email address has been verified.');
        setTimeout(() => navigate('/', { replace: true }), 2500);
      } catch (err: any) {
        setStatus('error');
        setMessage(err?.message || 'This verification link is invalid or has expired.');
      }
    };
    run();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl p-10 text-center shadow-xl max-w-md w-full mx-4">
        {status === 'verifying' && <Loader2 className="w-10 h-10 text-[var(--accent-primary)] animate-spin mx-auto mb-4" />}
        {status === 'success' && <CheckCircle2 className="w-10 h-10 text-[var(--status-success)] mx-auto mb-4" />}
        {status === 'error' && <XCircle className="w-10 h-10 text-[var(--status-error)] mx-auto mb-4" />}
        <p className="text-[var(--text-primary)] font-black uppercase italic tracking-tight">
          {status === 'success' ? 'Email Verified' : status === 'error' ? 'Verification Failed' : 'Verifying…'}
        </p>
        <p className="text-[var(--text-secondary)] text-[11px] font-bold uppercase tracking-widest mt-2">{message}</p>
        {status === 'error' && (
          <Link to="/" className="inline-block mt-6 text-[10px] font-black uppercase tracking-widest text-[var(--accent-primary)] hover:underline">
            Return to dashboard
          </Link>
        )}
      </div>
    </div>
  );
}
