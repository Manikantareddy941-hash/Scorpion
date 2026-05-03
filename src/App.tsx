import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './contexts/AuthContext';
// import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import ResetPassword from './pages/ResetPassword';
import ForgotPassword from './pages/ForgotPassword';
import VerifyOtp from './pages/VerifyOtp';
import ChangePassword from './pages/ChangePassword';
import SettingsPage from './pages/Settings';
import CodeInsights from './pages/CodeInsights';
import ProjectDetail from './pages/ProjectDetail';
import TasksPage from './pages/TasksPage';
import Teams from './pages/Teams';
import Alerts from './pages/Alerts';
import Reports from './pages/Reports';
import Governance from './pages/Governance';
import MultiRepoDashboard from './pages/MultiRepoDashboard';
import Profile from './pages/Profile';
import ScanResults from './pages/ScanResults';
import AIChat from './components/AIChat';
import { Shield } from 'lucide-react';
import AuthCallback from './pages/AuthCallback';
import AuditLog from './pages/AuditLog';
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

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

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

  // We rely on AuthProvider to do the initial session check.
  // The checkAppwrite function is kept for manual retry on the NetworkErrorPanel.

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: 'var(--bg-primary)' }}>
        <div className="flex flex-col items-center space-y-4">
          <Shield size={48} className="text-[var(--accent-primary)] animate-pulse" />
          <p className="text-lg text-[var(--text-secondary)]">Loading application...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden" style={{ 
      background: 'var(--bg-primary)', 
      minHeight: '100vh'
    }}>
      {networkError && (
        <div className="fixed top-0 left-0 w-full z-50 flex justify-center p-4 bg-transparent">
          <NetworkErrorPanel onRetry={checkAppwrite} />
        </div>
      )}
      <Toaster position="bottom-right" toastOptions={{ style: { background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', fontSize: '12px', fontWeight: 'bold' } }} />
      <div style={{ display: 'flex', alignItems: 'start', minHeight: '100vh', background: 'var(--bg-primary)' }}>
        {showSidebar && <Sidebar isCollapsed={isSidebarCollapsed} setIsCollapsed={setIsSidebarCollapsed} />}
        <div style={{ 
          flex: 1, 
          overflow: 'auto'
        }}>
          <Routes>
            <Route path="/auth" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/signup" element={<PublicRoute><Signup /></PublicRoute>} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
            <Route path="/verify-otp" element={<PublicRoute><VerifyOtp /></PublicRoute>} />
            <Route path="/reset-password" element={<PublicRoute><ResetPassword /></PublicRoute>} />
            <Route path="/projects/:id" element={<ProtectedRoute><ProjectDetail /></ProtectedRoute>} />
            <Route path="/tasks" element={<ProtectedRoute><TasksPage /></ProtectedRoute>} />
            <Route path="/" element={<ProtectedRoute><Dashboard isSidebarCollapsed={isSidebarCollapsed} /></ProtectedRoute>} />
            <Route path="/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
            <Route path="/teams" element={<ProtectedRoute><Teams /></ProtectedRoute>} />
            <Route path="/alerts" element={<ProtectedRoute><Alerts /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
            <Route path="/governance" element={<ProtectedRoute><Governance /></ProtectedRoute>} />
            <Route path="/repos" element={<ProtectedRoute><MultiRepoDashboard /></ProtectedRoute>} />
            <Route path="/insights" element={<ProtectedRoute><CodeInsights /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/scan-results" element={<ProtectedRoute><ScanResults /></ProtectedRoute>} />
            <Route path="/audit" element={<ProtectedRoute><AuditLog /></ProtectedRoute>} />
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        <AIChat open={isChatOpen} setOpen={setIsChatOpen} />
      </div>
      <Footer />
    </div>
  );
}

export default App;
