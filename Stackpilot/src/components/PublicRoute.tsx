import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ReactNode } from 'react';

export default function PublicRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return !user ? <>{children}</> : <Navigate to="/dashboard" replace />;
}
