import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './contexts/AuthContext';
import { useTheme } from './contexts/ThemeContext';
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
import Repositories from './pages/Repositories';
import Profile from './pages/Profile';
import ScanResults from './pages/ScanResults';
import SastDetail from './pages/SastDetail';
import SecretsDetail from './pages/SecretsDetail';
import InfraDetail from './pages/InfraDetail';
import ScaDetail from './pages/ScaDetail';
import SbomDetail from './pages/SbomDetail';
import AntipatternsDetail from './pages/AntipatternsDetail';
import DuplicatesDetail from './pages/DuplicatesDetail';
import DeadCodeDetail from './pages/DeadCodeDetail';
import QualityDetail from './pages/QualityDetail';
import AIChat from './components/AIChat';
import JourneyMap from './pages/JourneyMap';
import CodeActivity from './pages/CodeActivity';
import BuildPipeline from './pages/BuildPipeline';
import TestResults from './pages/TestResults';
import DeepAnalysis from './pages/DeepAnalysis';
import ReleaseGate from './pages/ReleaseGate';
import Monitor from './pages/Monitor';
import PolicyBuilder from './pages/PolicyBuilder';
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
import Navbar from './components/Navbar';
import Login from './pages/Login';
import Signup from './pages/Signup';

function App() {
  const { user, loading } = useAuth();
  const [networkError, setNetworkError] = useState(false);
  const location = useLocation();

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebarCollapsed') === 'true';
  });

  const handleSidebarCollapse = (collapsed: boolean) => {
    setIsSidebarCollapsed(collapsed);
    localStorage.setItem('sidebarCollapsed', String(collapsed));
  };

  const { theme } = useTheme();
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
    <div className="min-h-screen flex flex-col relative" style={{ 
      background: 'transparent', 
      minHeight: '100vh',
      position: 'relative',
      zIndex: 2
    }}>
      {networkError && (
        <div className="fixed top-0 left-0 w-full z-50 flex justify-center p-4 bg-transparent">
          <NetworkErrorPanel onRetry={checkAppwrite} />
        </div>
      )}
      <Toaster position="bottom-right" toastOptions={{ style: { background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', fontSize: '12px', fontWeight: 'bold' } }} />
      <div className="flex flex-1 min-w-0 relative">
        {showSidebar && (
          <div className="sticky top-0 h-screen shrink-0 z-50">
            <Sidebar isCollapsed={isSidebarCollapsed} setIsCollapsed={handleSidebarCollapse} />
          </div>
        )}

        {/* Page Content */}
        <div className="flex flex-col flex-1 min-w-0 bg-transparent transition-all duration-300">
          {/* Navbar sticky */}
          {user && !isAuthPage && (
            <div className="sticky top-0 z-40 p-3 pb-0 bg-transparent">
              <Navbar className="rounded-2xl shrink-0" />
            </div>
          )}

          <main className="flex-1 p-3 flex flex-col bg-transparent">
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
              <Route path="/repos" element={<ProtectedRoute><Repositories /></ProtectedRoute>} />
              <Route path="/insights" element={<ProtectedRoute><CodeInsights /></ProtectedRoute>} />
              <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
               <Route path="/scan-results" element={<ProtectedRoute><ScanResults /></ProtectedRoute>} />
              <Route path="/scans/:scanId" element={<ProtectedRoute><ScanResults /></ProtectedRoute>} />
              <Route path="/scans/:scanId/sast" element={<ProtectedRoute><SastDetail /></ProtectedRoute>} />
              <Route path="/scans/:scanId/secrets" element={<ProtectedRoute><SecretsDetail /></ProtectedRoute>} />
              <Route path="/scans/:scanId/infra" element={<ProtectedRoute><InfraDetail /></ProtectedRoute>} />
              <Route path="/scans/:scanId/sca" element={<ProtectedRoute><ScaDetail /></ProtectedRoute>} />
              <Route path="/scans/:scanId/sbom" element={<ProtectedRoute><SbomDetail /></ProtectedRoute>} />
              <Route path="/scans/:scanId/antipatterns" element={<ProtectedRoute><AntipatternsDetail /></ProtectedRoute>} />
              <Route path="/scans/:scanId/duplicates" element={<ProtectedRoute><DuplicatesDetail /></ProtectedRoute>} />
              <Route path="/scans/:scanId/deadcode" element={<ProtectedRoute><DeadCodeDetail /></ProtectedRoute>} />
              <Route path="/scans/:scanId/quality" element={<ProtectedRoute><QualityDetail /></ProtectedRoute>} />
              <Route path="/audit" element={<ProtectedRoute><AuditLog /></ProtectedRoute>} />
              <Route path="/map" element={<ProtectedRoute><JourneyMap /></ProtectedRoute>} />
              <Route path="/code" element={<ProtectedRoute><CodeActivity /></ProtectedRoute>} />
              <Route path="/builds" element={<ProtectedRoute><BuildPipeline /></ProtectedRoute>} />
              <Route path="/tests" element={<ProtectedRoute><TestResults /></ProtectedRoute>} />
              <Route path="/analyze" element={<ProtectedRoute><DeepAnalysis /></ProtectedRoute>} />
              <Route path="/release" element={<ProtectedRoute><ReleaseGate /></ProtectedRoute>} />
              <Route path="/monitor" element={<ProtectedRoute><Monitor /></ProtectedRoute>} />
              <Route path="/dashboard" element={<Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
      
      {!isAuthPage && <div className="w-full relative z-10"><Footer /></div>}
      
      {!isAuthPage && <AIChat open={isChatOpen} setOpen={setIsChatOpen} />}
    </div>
  );
}

export default App;
