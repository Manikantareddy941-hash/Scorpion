import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import SecurityDashboard from './pages/SecurityDashboard';
import ResetPassword from './pages/ResetPassword';
import ForgotPassword from './pages/ForgotPassword';
import VerifyOtp from './pages/VerifyOtp';
import ChangePassword from './pages/ChangePassword';
import SettingsPage from './pages/Settings';
import CodeInsights from './pages/CodeInsights';
import DevOpsDashboard from './pages/DevOpsDashboard';
import ProjectDetail from './pages/ProjectDetail';
import Teams from './pages/Teams';
import Alerts from './pages/Alerts';
import Reports from './pages/Reports';
import AIAnalytics from './pages/AIAnalytics';
import Profile from './pages/Profile';
import ScanResults from './pages/ScanResults';
import AIChat from './components/AIChat';
import { Shield } from 'lucide-react';
import AuthCallback from './pages/AuthCallback';
import Footer from './components/Footer';
import NetworkErrorPanel from './components/NetworkErrorPanel';
import { useEffect, useState } from 'react';
import { account } from './lib/appwrite';
import ProtectedRoute from './components/ProtectedRoute';
import PublicRoute from './components/PublicRoute';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import Signup from './pages/Signup';

function App() {
  const { user, loading } = useAuth();
  const [networkError, setNetworkError] = useState(false);
  const location = useLocation();

  const isAuthPage = ['/login', '/signup', '/forgot-password', '/verify-otp', '/reset-password', '/auth/callback', '/auth'].includes(location.pathname);
  const showSidebar = !isAuthPage && user;

  useEffect(() => {
    if (!import.meta.env.VITE_APPWRITE_ENDPOINT || !import.meta.env.VITE_APPWRITE_PROJECT_ID) {
      console.warn('Missing Appwrite env vars: VITE_APPWRITE_ENDPOINT and/or VITE_APPWRITE_PROJECT_ID');
    }
  }, []);

  const checkAppwrite = async () => {
    try {
      await account.get();
      setNetworkError(false);
    } catch (err: any) {
      if (err.code !== 401) {
        setNetworkError(true);
      } else {
        setNetworkError(false);
      }
    }
  };

  useEffect(() => {
    checkAppwrite();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Shield className="w-12 h-12 text-blue-600 animate-pulse" />
          <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest animate-pulse italic">Checking security protocols…</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0D0D0D', minHeight: '100vh' }}>
      {networkError && (
        <div className="fixed top-0 left-0 w-full z-50 flex justify-center p-4 bg-transparent">
          <NetworkErrorPanel onRetry={checkAppwrite} />
        </div>
      )}
      <div style={{ display: 'flex', minHeight: '100vh', background: '#0D0D0D' }}>
        {showSidebar && <Sidebar />}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <Routes>
            <Route path="/auth" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/signup" element={<PublicRoute><Signup /></PublicRoute>} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
            <Route path="/verify-otp" element={<PublicRoute><VerifyOtp /></PublicRoute>} />
            <Route path="/reset-password" element={<PublicRoute><ResetPassword /></PublicRoute>} />
            <Route path="/devops" element={<ProtectedRoute><DevOpsDashboard /></ProtectedRoute>} />
            <Route path="/projects/:id" element={<ProtectedRoute><ProjectDetail /></ProtectedRoute>} />
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/security" element={<ProtectedRoute><SecurityDashboard /></ProtectedRoute>} />
            <Route path="/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
            <Route path="/teams" element={<ProtectedRoute><Teams /></ProtectedRoute>} />
            <Route path="/alerts" element={<ProtectedRoute><Alerts /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
            <Route path="/insights" element={<ProtectedRoute><CodeInsights /></ProtectedRoute>} />
            <Route path="/ai-insights" element={<ProtectedRoute><AIAnalytics /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/scan-results" element={<ProtectedRoute><ScanResults /></ProtectedRoute>} />
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Footer />
        </div>
      </div>
      <AIChat />
    </div>
  );
}

export default App;