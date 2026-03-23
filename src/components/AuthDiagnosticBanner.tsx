import { AlertCircle, WifiOff, ShieldOff } from 'lucide-react';
import { AuthHealthResult } from '../lib/authHealthCheck';

interface AuthDiagnosticBannerProps {
  health: AuthHealthResult;
}

const AuthDiagnosticBanner = ({ health }: AuthDiagnosticBannerProps) => {
  if (health.backendReachable && health.appwriteReachable) {
    return null;
  }

  const getErrorInfo = () => {
    switch (health.errorType) {
      case 'CORS':
        return {
          icon: <AlertCircle className="w-5 h-5 text-[var(--status-error)]" />,
          title: 'CORS Misconfiguration',
          message: 'The frontend cannot reach the backend. Check that the FRONTEND_URL environment variable on the backend matches your browser\'s URL.'
        };
      case 'NETWORK':
        return {
          icon: <WifiOff className="w-5 h-5 text-[var(--status-warning)]" />,
          title: 'Cannot Connect to Authentication Server',
          message: 'Could not connect to the backend server. Please ensure the backend is running and accessible.'
        };
      case 'DNS_BLOCK':
        return {
          icon: <ShieldOff className="w-5 h-5 text-[var(--accent-primary)]" />,
          title: 'Appwrite Unreachable',
          message: 'The Appwrite domain may be blocked by your ISP. Try changing your DNS to 1.1.1.1 or 8.8.8.8.'
        };
      case 'UNKNOWN':
      default:
        return {
          icon: <AlertCircle className="w-5 h-5 text-[var(--text-secondary)]" />,
          title: 'Unexpected Network Error',
          message: 'Authentication failed due to an unexpected network error. Please check your internet connection.'
        };
    }
  };

  const { icon, title, message } = getErrorInfo();

  return (
    <div className="bg-[var(--status-error)]/10 border border-[var(--status-error)]/20 rounded-lg p-4 mt-4">
      <div className="flex">
        <div className="flex-shrink-0">{icon}</div>
        <div className="ml-3">
          <h3 className="text-sm font-medium text-[var(--status-error)]">{title}</h3>
          <div className="mt-2 text-sm text-[var(--status-error)] opacity-80">
            <p>{message}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthDiagnosticBanner;
