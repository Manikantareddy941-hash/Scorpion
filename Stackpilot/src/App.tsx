import { Routes, Route } from 'react-router-dom';
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
import AuthCallback from './pages/AuthCallback';
import Footer from './components/Footer';
import NetworkErrorPanel from './components/NetworkErrorPanel';
import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import ProtectedRoute from './components/ProtectedRoute';
import PublicRoute from './components/PublicRoute';
import AuthSystemStatus from './components/AuthSystemStatus';

function App() {
  const { loading } = useAuth();
  const [networkError, setNetworkError] = useState(false);

  // Global Supabase health check
  const checkSupabase = async () => {
    try {
      const { error } = await supabase.auth.getSession();
      if (error) throw error;
      setNetworkError(false);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Supabase network error:', err);
      setNetworkError(true);
    }
  };

  useEffect(() => {
    checkSupabase().catch(() => { });
  }, []);

  // Env validation
  useEffect(() => {
    if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
      console.warn('Missing Supabase env vars');
    }
  }, []);

  // Only loading (from AuthContext) should block routing
  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-6">
          <div className="logo-mark !w-16 !h-16 !text-2xl animate-pulse">SP</div>
          <p className="text-[13px] font-semibold text-text-subtle uppercase tracking-[0.2em] animate-pulse">Synchronizing Security Stack</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="w-full flex justify-center items-center py-2 bg-transparent z-40">
        <AuthSystemStatus />
      </div>
      {networkError && (
        <div className="fixed top-0 left-0 w-full z-50 flex justify-center p-4 bg-transparent">
          <NetworkErrorPanel onRetry={checkSupabase} />
        </div>
      )}
      <div className="flex-1">
        <Routes>
          <Route path="/auth" element={<PublicRoute><Auth /></PublicRoute>} />
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
        </Routes>
      </div>
      <Footer />
    </div>
  );
}

export default App;



