import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useAuth } from './contexts/AuthContext';
import { useTheme } from './contexts/ThemeContext';
import { Shield } from 'lucide-react';
import { account } from './lib/appwrite';
// Structural chrome stays eager — needed on every route, no benefit to splitting.
import ProtectedRoute from './components/ProtectedRoute';
import PublicRoute from './components/PublicRoute';
import Sidebar from './components/Sidebar';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import NetworkErrorPanel from './components/NetworkErrorPanel';

// Everything else is route content or below-the-fold chrome — code-split so a
// visit to one page doesn't ship the JS for all 40+ others.
const Dashboard = lazy(() => import('./components/Dashboard'));
const Issues = lazy(() => import('./pages/Issues'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const VerifyOtp = lazy(() => import('./pages/VerifyOtp'));
const ChangePassword = lazy(() => import('./pages/ChangePassword'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const CodeInsights = lazy(() => import('./pages/CodeInsights'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'));
const TasksPage = lazy(() => import('./pages/TasksPage'));
const Teams = lazy(() => import('./pages/Teams'));
const Alerts = lazy(() => import('./pages/Alerts'));
const Reports = lazy(() => import('./pages/Reports'));
const Governance = lazy(() => import('./pages/Governance'));
const Repositories = lazy(() => import('./pages/Repositories'));
const Profile = lazy(() => import('./pages/Profile'));
const ScanResults = lazy(() => import('./pages/ScanResults'));
const SastDetail = lazy(() => import('./pages/SastDetail'));
const SecretsDetail = lazy(() => import('./pages/SecretsDetail'));
const InfraDetail = lazy(() => import('./pages/InfraDetail'));
const ScaDetail = lazy(() => import('./pages/ScaDetail'));
const SbomDetail = lazy(() => import('./pages/SbomDetail'));
const AntipatternsDetail = lazy(() => import('./pages/AntipatternsDetail'));
const DuplicatesDetail = lazy(() => import('./pages/DuplicatesDetail'));
const DeadCodeDetail = lazy(() => import('./pages/DeadCodeDetail'));
const QualityDetail = lazy(() => import('./pages/QualityDetail'));
const AIChat = lazy(() => import('./components/AIChat'));
const EchoFAB = lazy(() => import('./components/ui/EchoFAB'));
const JourneyMap = lazy(() => import('./pages/JourneyMap'));
const CodeActivity = lazy(() => import('./pages/CodeActivity'));
const Build = lazy(() => import('./pages/Build'));
const Deploy = lazy(() => import('./pages/Deploy'));
const TestResults = lazy(() => import('./pages/TestResults'));
const DeepAnalysis = lazy(() => import('./pages/DeepAnalysis'));
const ReleaseGate = lazy(() => import('./pages/ReleaseGate'));
const Monitor = lazy(() => import('./pages/Monitor'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const PlanWorkspace = lazy(() => import('./pages/PlanWorkspace'));
const PolicyBuilder = lazy(() => import('./pages/PolicyBuilder'));
const TicketDashboard = lazy(() => import('./pages/TicketDashboard'));
const TicketDetail = lazy(() => import('./pages/TicketDetail'));
const JiraSettings = lazy(() => import('./pages/JiraSettings'));
const Login = lazy(() => import('./pages/Login'));
const Signup = lazy(() => import('./pages/Signup'));
const ProductTour = lazy(() => import('./components/ProductTour'));

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

  const { echoFreeRoam } = useTheme();
  const isAuthPage = ['/login', '/signup', '/forgot-password', '/verify-otp', '/reset-password', '/auth/callback', '/auth', '/verify-email'].includes(location.pathname);
  const showSidebar = !isAuthPage && user;

  useEffect(() => {
    if (!import.meta.env.VITE_APPWRITE_ENDPOINT || !import.meta.env.VITE_APPWRITE_PROJECT_ID) {
      console.warn('Missing Appwrite env vars: VITE_APPWRITE_ENDPOINT and/or VITE_APPWRITE_PROJECT_ID');
    }
  }, []);

  useEffect(() => {
    if (user && !localStorage.getItem('scorpion_demo_seeded')) {
      import('./lib/demoData').then(({ seedDemoData }) => {
        seedDemoData();
      });
    }
  }, [user]);

  useEffect(() => {
    const openChat = () => setIsChatOpen(true);
    window.addEventListener('scorpion:open-chat', openChat);
    return () => window.removeEventListener('scorpion:open-chat', openChat);
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
            <Sidebar 
              isCollapsed={isSidebarCollapsed} 
              setIsCollapsed={handleSidebarCollapse} 
            />
          </div>
        )}

        {/* Page Content */}
        <div className="flex flex-col flex-1 min-w-0 bg-transparent transition-all duration-300">
          {/* Navbar sticky */}
          {user && !isAuthPage && (
            <div className="sticky top-0 z-40 p-3 pb-0 bg-transparent">
              <Navbar 
                className="rounded-2xl shrink-0" 
              />
            </div>
          )}

          <main className="flex-1 p-3 flex flex-col bg-transparent">
            <Suspense fallback={
              <div className="flex items-center justify-center flex-1">
                <Shield size={32} className="text-[var(--accent-primary)] animate-pulse" />
              </div>
            }>
            <Routes>
              <Route path="/auth" element={<Navigate to="/login" replace />} />
              <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
              <Route path="/signup" element={<PublicRoute><Signup /></PublicRoute>} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
              <Route path="/verify-otp" element={<PublicRoute><VerifyOtp /></PublicRoute>} />
              <Route path="/reset-password" element={<PublicRoute><ResetPassword /></PublicRoute>} />
              <Route path="/projects/:id" element={<ProtectedRoute><ProjectDetail /></ProtectedRoute>} />
              <Route path="/tasks" element={<ProtectedRoute><TasksPage /></ProtectedRoute>} />
              <Route path="/tickets" element={<ProtectedRoute><TicketDashboard /></ProtectedRoute>} />
              <Route path="/tickets/:id" element={<ProtectedRoute><TicketDetail /></ProtectedRoute>} />
              <Route path="/jira-settings" element={<ProtectedRoute><JiraSettings /></ProtectedRoute>} />
              <Route path="/plan/*" element={<ProtectedRoute><PlanWorkspace /></ProtectedRoute>} />
              <Route path="/policy-builder" element={<ProtectedRoute><PolicyBuilder /></ProtectedRoute>} />
              <Route path="/" element={<ProtectedRoute><Dashboard isSidebarCollapsed={isSidebarCollapsed} /></ProtectedRoute>} />
              <Route path="/issues" element={<ProtectedRoute><Issues /></ProtectedRoute>} />
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
              <Route path="/build" element={<ProtectedRoute><Build /></ProtectedRoute>} />
              <Route path="/pipelines" element={<ProtectedRoute><Build /></ProtectedRoute>} />
              <Route path="/deploy" element={<ProtectedRoute><Deploy /></ProtectedRoute>} />
              <Route path="/deployments" element={<ProtectedRoute><Deploy /></ProtectedRoute>} />
              <Route path="/tests" element={<ProtectedRoute><TestResults /></ProtectedRoute>} />
              <Route path="/analyze" element={<ProtectedRoute><DeepAnalysis /></ProtectedRoute>} />
              <Route path="/release" element={<ProtectedRoute><ReleaseGate /></ProtectedRoute>} />
              <Route path="/monitor" element={<ProtectedRoute><Monitor /></ProtectedRoute>} />
              <Route path="/dashboard" element={<Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
          </main>
        </div>
      </div>
      
      {!isAuthPage && <div className="w-full relative z-10"><Footer /></div>}

      <Suspense fallback={null}>
        {!isAuthPage && <AIChat open={isChatOpen} setOpen={setIsChatOpen} />}

        {!isAuthPage && !isChatOpen && (
          <EchoFAB open={isChatOpen} onClick={() => setIsChatOpen(true)} freeRoam={echoFreeRoam} />
        )}

        {!isAuthPage && user && <ProductTour />}
      </Suspense>
    </div>
  );
}

export default App;
