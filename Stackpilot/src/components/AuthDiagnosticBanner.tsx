import { AlertCircle, WifiOff, ShieldOff } from 'lucide-react';
import { AuthHealthResult } from '../lib/authHealthCheck';

interface AuthDiagnosticBannerProps {
  health: AuthHealthResult;
}

const AuthDiagnosticBanner = ({ health }: AuthDiagnosticBannerProps) => {
  if (health.backendReachable && health.supabaseReachable) {
    return null;
  }

  const getErrorInfo = () => {
    switch (health.errorType) {
      case 'CORS':
        return {
          icon: <AlertCircle className="w-5 h-5" />,
          title: 'Infrastructure Misconfiguration',
          message: 'Security orchestration cannot establish a handshake with the primary mission control. Verify CORS protocols and backend environment synchronization.',
          type: 'danger'
        };
      case 'NETWORK':
        return {
          icon: <WifiOff className="w-5 h-5" />,
          title: 'Mission Control Unreachable',
          message: 'The operational backend is currently offline or unreachable via the provided network vector. Re-verify service uptime.',
          type: 'warning'
        };
      case 'DNS_BLOCK':
        return {
          icon: <ShieldOff className="w-5 h-5" />,
          title: 'Storage Link Obstructed',
          message: 'Intelligence storage layers are currently inaccessible. This may be caused by network-level DNS interception or firewall policies.',
          type: 'danger'
        };
      case 'UNKNOWN':
      default:
        return {
          icon: <AlertCircle className="w-5 h-5" />,
          title: 'Signal Synthesis Error',
          message: 'An unexpected intercept occurred during authentication synthesis. Transmission was interrupted by an unknown vector.',
          type: 'neutral'
        };
    }
  };

  const { icon, title, message, type } = getErrorInfo();

  const containerClass = {
    danger: 'bg-danger-light border-danger/10 text-danger',
    warning: 'bg-warning-light border-warning/10 text-warning',
    neutral: 'bg-surface border-border text-text-muted'
  }[type as 'danger' | 'warning' | 'neutral'];

  return (
    <div className={`mt-6 p-5 rounded-xl border ${containerClass} animate-fade-up`}>
      <div className="flex gap-4">
        <div className="shrink-0">{icon}</div>
        <div>
          <h3 className="text-[14px] font-semibold leading-none mb-2">{title}</h3>
          <p className="text-[12px] opacity-80 leading-relaxed font-medium">{message}</p>
        </div>
      </div>
    </div>
  );
};

export default AuthDiagnosticBanner;
