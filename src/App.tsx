import { Routes, Route, Navigate } from 'react-router-dom';
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
import { Shield } from 'lucide-react';

function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Shield className="w-12 h-12 text-blue-600 animate-pulse" />
          <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest animate-pulse italic">Authenticating Pilot...</h2>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/auth" element={!user ? <Auth /> : <Navigate to="/" />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/verify-otp" element={<VerifyOtp />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/devops" element={user ? <DevOpsDashboard /> : <Navigate to="/auth" />} />
      <Route path="/projects/:id" element={user ? <ProjectDetail /> : <Navigate to="/auth" />} />
      <Route path="/" element={user ? <Dashboard /> : <Navigate to="/auth" />} />
      <Route path="/security" element={user ? <SecurityDashboard /> : <Navigate to="/auth" />} />
      <Route path="/change-password" element={user ? <ChangePassword /> : <Navigate to="/auth" />} />
      <Route path="/settings" element={user ? <SettingsPage /> : <Navigate to="/auth" />} />
      <Route path="/teams" element={user ? <Teams /> : <Navigate to="/auth" />} />
      <Route path="/alerts" element={user ? <Alerts /> : <Navigate to="/auth" />} />
      <Route path="/reports" element={user ? <Reports /> : <Navigate to="/auth" />} />
      <Route path="/insights" element={user ? <CodeInsights /> : <Navigate to="/auth" />} />
      <Route path="/ai-insights" element={user ? <AIAnalytics /> : <Navigate to="/auth" />} />
    </Routes>
  );
}

export default App;



