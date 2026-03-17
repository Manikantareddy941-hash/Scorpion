import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { account, ID, OAUTH_SUCCESS_URL, OAUTH_FAILURE_URL } from "../lib/appwrite";
import { Models, OAuthProvider } from "appwrite";

type AppUser = Models.User<Models.Preferences>;

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  setUser: (user: AppUser | null) => void;

  signUp: (email: string, password: string, name?: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  signInWithOAuth: (provider: "google" | "github") => Promise<{ error?: any }>;

  requestReset: (email: string) => Promise<{ error?: string; message?: string }>;
  verifyResetOtp: (email: string, otp: string) => Promise<{ error?: string; resetToken?: string }>;
  completeReset: (resetToken: string, newPassword: string) => Promise<{ error?: string }>;

  updatePassword: (newPassword: string) => Promise<{ error?: any }>;
  getJWT: () => Promise<string | null>;
  refreshUser: () => Promise<AppUser | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const BACKEND_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

  const location = useLocation();

  useEffect(() => {
    // Only check for user if we are not on a public auth page
    // This stops the 401 loop on the login page as requested
    const publicPaths = ['/login', '/signup', '/auth/callback', '/forgot-password', '/reset-password', '/verify-otp', '/auth'];

    // Normalize path by removing trailing slashes
    const currentPath = location.pathname.replace(/\/$/, '') || '/';

    console.log('[AuthContext] Current normalized path:', currentPath);

    if (publicPaths.includes(currentPath)) {
      console.log('[AuthContext] Skipping account.get() for public path:', currentPath);
      setLoading(false);
      return;
    }

    const checkUser = async () => {
      try {
        console.log('[AuthContext] Executing account.get() for path:', currentPath);
        const currentUser = await account.get();
        setUser(currentUser);
      } catch (error: any) {
        // 401 is expected for guest users, handle it silently
        if (error?.code === 401) {
          console.log('[AuthContext] No session (401)');
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
      return { error: null };
    } catch (error: any) {
      return { error };
    }
  };

  const signInWithOAuth = async (provider: "google" | "github") => {
    try {
      await account.createOAuth2Token(
        provider === "google" ? OAuthProvider.Google : OAuthProvider.Github,
        OAUTH_SUCCESS_URL,
        OAUTH_FAILURE_URL
      );
      return { error: null };
    } catch (error: any) {
      return { error };
    }
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
    try {
      await account.deleteSession("current");
      setUser(null);
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