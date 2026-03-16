import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { account, ID } from "../lib/appwrite";
import { Models, OAuthProvider } from "appwrite";

type AppUser = Models.User<Models.Preferences>;

interface AuthContextType {
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const BACKEND_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

  // ✅ Runs once on app load
  useEffect(() => {
    const checkUser = async () => {
      try {
        const currentUser = await account.get();
        console.log("Context user:", currentUser);
        setUser(currentUser);
      } catch {
        console.log("No active session");
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkUser();
  }, []);

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
      await account.createOAuth2Session(
        provider === "google" ? OAuthProvider.Google : OAuthProvider.Github,
        `${window.location.origin}/auth/callback`,
        `${window.location.origin}/login`
      );
      return { error: null };
    } catch (error: any) {
      return { error };
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
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}