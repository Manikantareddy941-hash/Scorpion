import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { account, ID } from "../lib/appwrite";
import { Models, OAuthProvider } from "appwrite";

type AppUser = Models.User<Models.Preferences>;

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  setUser: (user: AppUser | null) => void;

  signUp: (email: string, password: string, name?: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  signInWithOAuth: (provider: string) => void;

  requestReset: (email: string) => Promise<{ error?: string; message?: string }>;
  verifyResetOtp: (email: string, otp: string) => Promise<{ error?: string; resetToken?: string }>;
  completeReset: (resetToken: string, newPassword: string) => Promise<{ error?: string }>;

  updatePassword: (newPassword: string) => Promise<{ error?: any }>;
  getGithubToken: () => Promise<string | null>;
  getJWT: () => Promise<string | null>;
  refreshUser: () => Promise<AppUser | null>;
  role: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const BACKEND_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
  const location = useLocation();

  useEffect(() => {
    const publicPaths = ['/login', '/signup', '/auth/callback', '/forgot-password', '/reset-password', '/verify-otp', '/auth'];
    const currentPath = location.pathname.replace(/\/$/, '') || '/';

    if (publicPaths.includes(currentPath)) {
      setLoading(false);
      return;
    }

    const checkUser = async () => {
      try {
        const currentUser = await account.get();
        setUser(currentUser);
        
        // Fetch role from backend instead of direct Appwrite query to avoid 401
        const jwt = await account.createJWT();
        const roleResponse = await fetch(`${BACKEND_URL}/api/user/role`, {
          headers: { 'Authorization': `Bearer ${jwt.jwt}` }
        }).catch(() => null);

        if (roleResponse && roleResponse.ok) {
          const { role } = await roleResponse.json();
          setRole(role);
        }
      } catch (error: any) {
        if (error?.code === 401) {
          setUser(null);
        } else {
          console.error("[AuthContext] Auth check failed:", error);
          setUser(null);
        }
      } finally {
        setLoading(false);
      }
    };
    checkUser();
  }, [location.pathname]);

  const signUp = async (email: string, password: string, name: string = "") => {
    try {
      await account.create(ID.unique(), email, password, name || email.split("@")[0]);
      await account.createEmailPasswordSession(email, password);
      const currentUser = await account.get();
      setUser(currentUser);
      
      const { auditLogger } = await import("../lib/auditLogger");
      auditLogger.log({
        userId: currentUser.$id,
        action: 'sign_up',
        resource: 'user',
        details: `User signed up with email: ${email}`,
        status: 'success'
      });

      return { error: null };
    } catch (error: any) {
      return { error };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      await account.createEmailPasswordSession(email, password);
      const currentUser = await account.get();
      setUser(currentUser);

      const { auditLogger } = await import("../lib/auditLogger");
      auditLogger.log({
        userId: currentUser.$id,
        action: 'login',
        resource: 'user',
        details: `User logged in with email: ${email}`,
        status: 'success'
      });

      return { error: null };
    } catch (error: any) {
      return { error };
    }
  };

  const signInWithOAuth = (provider: string) => {
    const baseUrl = window.location.origin;
    const returnTo = sessionStorage.getItem('oauth_return_to') || '/dashboard';
    sessionStorage.setItem('oauth_return_to', returnTo);
    
    account.createOAuth2Session(
      provider === 'google' ? OAuthProvider.Google : OAuthProvider.Github,
      `${baseUrl}/auth/callback`,
      `${baseUrl}/login`,
      provider === 'github' ? ['repo', 'user:email'] : []
    );
  };

  const refreshUser = async () => {
    try {
      const currentUser = await account.get();
      setUser(currentUser);
      return currentUser;
    } catch {
      setUser(null);
      return null;
    }
  };

  const signOut = async () => {
    if (!user) return;
    const userId = user.$id;
    try {
      await account.deleteSession("current");
      setUser(null);
      
      const { auditLogger } = await import("../lib/auditLogger");
      auditLogger.log({
        userId,
        action: 'logout',
        resource: 'user',
        details: 'User logged out',
        status: 'success'
      });
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const requestReset = async (email: string) => {
    try {
      const response = await fetch(`${BACKEND_URL}/auth/request-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) return { error: data.error };
      return { message: data.message };
    } catch {
      return { error: "Failed to connect to authentication server" };
    }
  };

  const verifyResetOtp = async (email: string, otp: string) => {
    try {
      const response = await fetch(`${BACKEND_URL}/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp }),
      });
      const data = await response.json();
      if (!response.ok) return { error: data.error };
      return { resetToken: data.resetToken };
    } catch {
      return { error: "Failed to connect to authentication server" };
    }
  };

  const completeReset = async (resetToken: string, newPassword: string) => {
    try {
      const response = await fetch(`${BACKEND_URL}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetToken, newPassword }),
      });
      const data = await response.json();
      if (!response.ok) return { error: data.error };
      return {};
    } catch {
      return { error: "Failed to connect to authentication server" };
    }
  };

  const updatePassword = async (newPassword: string) => {
    try {
      await account.updatePassword(newPassword);
      return { error: null };
    } catch (error: any) {
      return { error };
    }
  };

  const getGithubToken = async () => {
    try {
      if (import.meta.env.DEV) {
        return 'mock-github-token';
      }
      const session = await account.getSession('current');
      if (session.provider === 'github') {
        return session.providerAccessToken;
      }
      return null;
    } catch (error) {
      console.error("Provider token error:", error);
      return null;
    }
  };

  const getJWT = async () => {
    try {
      const jwt = await account.createJWT();
      return jwt.jwt;
    } catch (error) {
      console.error("JWT error:", error);
      return null;
    }
  };


  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        setUser,
        signUp,
        signIn,
        signOut,
        signInWithOAuth,
        requestReset,
        verifyResetOtp,
        completeReset,
        updatePassword,
        getJWT,
        refreshUser,
        getGithubToken,
        role,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
