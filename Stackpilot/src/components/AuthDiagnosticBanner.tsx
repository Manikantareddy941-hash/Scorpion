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
          icon: <AlertCircle className="w-5 h-5 text-red-500" />,
          title: 'CORS Misconfiguration',
          message: 'The frontend cannot reach the backend. Check that the FRONTEND_URL environment variable on the backend matches your browser\'s URL. The browser console may have more details.'
        };
      case 'NETWORK':
        return {
          icon: <WifiOff className="w-5 h-5 text-yellow-500" />,
          title: 'Cannot Connect to Authentication Server',
          message: 'Could not connect to the backend server. Please ensure the backend is running and accessible.'
        };
      case 'DNS_BLOCK':
        return {
          icon: <ShieldOff className="w-5 h-5 text-blue-500" />,
          title: 'Supabase Unreachable',
          message: 'The Supabase domain may be blocked by your ISP. Try changing your DNS to 1.1.1.1 or 8.8.8.8, or use a VPN.'
        };
      case 'UNKNOWN':
      default:
        return {
          icon: <AlertCircle className="w-5 h-5 text-gray-500" />,
          title: 'Unexpected Network Error',
          message: 'Authentication failed due to an unexpected network error. Please check your internet connection and try again.'
        };
    }
  };

  const { icon, title, message } = getErrorInfo();

  return (
    <div className="bg-red-500/10 dark:bg-red-500/10 border border-red-500/20 rounded-lg p-4 mt-4">
      <div className="flex">
        <div className="flex-shrink-0">{icon}</div>
        <div className="ml-3">
          <h3 className="text-sm font-medium text-red-800 dark:text-red-300">{title}</h3>
          <div className="mt-2 text-sm text-red-700 dark:text-red-200">
            <p>{message}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthDiagnosticBanner;
