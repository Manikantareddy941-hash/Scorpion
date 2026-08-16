import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ReactNode } from 'react';
import EmailVerificationBanner from './EmailVerificationBanner';

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  // Mounted here rather than per page so every authenticated surface carries it;
  // the banner returns null unless emailVerification is explicitly false.
  return user ? (
    <>
      <EmailVerificationBanner />
      {children}
    </>
  ) : (
    <Navigate to="/login" replace />
  );
}
