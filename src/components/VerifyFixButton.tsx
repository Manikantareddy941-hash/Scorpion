import React, { useState } from 'react';
import { ShieldCheck, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { verifyService } from '../services/verifyService';
import { auditService } from '../services/auditService';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';

interface VerifyFixButtonProps {
  taskId: string;
  repoId: string;
  repoUrl: string;
  onVerified: () => void;
}

export default function VerifyFixButton({ taskId, repoId, repoUrl, onVerified }: VerifyFixButtonProps) {
  const { t } = useTranslation();
  const { getJWT } = useAuth();
  const [isVerifying, setIsVerifying] = useState(false);
  const [status, setStatus] = useState<'idle' | 'scanning' | 'failed' | 'success'>('idle');

  const handleVerify = async () => {
    if (!repoId) {
      toast.error(t('verify.no_repo'));
      return;
    }

    setIsVerifying(true);
    setStatus('scanning');
    
    try {
      const token = await getJWT();
      if (!token) throw new Error("Auth required");

      // 1. Trigger Scan
      const scanData = await verifyService.triggerReScan(repoId, token);
      const scanId = scanData.scanId;

      // 2. Poll Status
      let completed = false;
      let attempts = 0;
      while (!completed && attempts < 30) {
        await new Promise(r => setTimeout(r, 3000));
        const statusData = await verifyService.pollScanStatus(scanId, token);
        if (statusData.status === 'completed') {
          completed = true;
        } else if (statusData.status === 'failed') {
          throw new Error("Scan failed during verification");
        }
        attempts++;
      }

      if (!completed) throw new Error("Verification timed out");

      // 3. Mark as verified
      const verified = await verifyService.markVulnerabilityAsVerified(repoId, '');
      
      if (verified) {
        setStatus('success');
        
        // Log audit event
        await auditService.log(
          'VULNERABILITY_VERIFIED', 
          'Repository', 
          `Fix verified for task ${taskId} in repository ${repoId}`,
          repoId
        );

        toast.success(t('verify.success'));
        setTimeout(() => onVerified(), 2000);
      } else {
        setStatus('failed');
        toast.error(t('verify.still_found'));
      }
    } catch (err: any) {
      console.error(err);
      setStatus('failed');
      toast.error(err.message || t('verify.error'));
    } finally {
      setIsVerifying(false);
    }
  };

  if (status === 'success') {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 bg-green-500/20 text-green-500 border border-green-500/30 rounded-lg text-[9px] font-black uppercase tracking-widest italic">
        <CheckCircle2 className="w-3 h-3" /> {t('verify.verified')}
      </div>
    );
  }

  return (
    <button
      onClick={handleVerify}
      disabled={isVerifying}
      className={`
        flex items-center gap-2 px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest italic transition-all
        ${status === 'failed' 
          ? 'bg-red-500/10 text-red-500 border border-red-500/30' 
          : 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border border-[var(--accent-primary)]/30 hover:bg-[var(--accent-primary)] hover:text-white'
        }
        ${isVerifying ? 'opacity-70 cursor-not-allowed' : ''}
      `}
    >
      {isVerifying ? (
        <RefreshCw className="w-3 h-3 animate-spin" />
      ) : status === 'failed' ? (
        <AlertTriangle className="w-3 h-3" />
      ) : (
        <ShieldCheck className="w-3 h-3" />
      )}
      {isVerifying ? t('verify.verifying') : status === 'failed' ? t('verify.retry') : t('verify.button')}
    </button>
  );
}
