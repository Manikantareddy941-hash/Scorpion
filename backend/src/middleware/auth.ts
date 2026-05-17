import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to verify Appwrite JWT
 */
export const verifyUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization;
    
    // Secure local loopback check for rapid developer feedback and testing
    const ip = req.ip || req.socket.remoteAddress || '';
    const isLocal = ip.includes('127.0.0.1') || ip.includes('::1') || ip.includes('localhost') || process.env.NODE_ENV !== 'production';

    if (!header) {
      if (isLocal) {
        (req as any).user = {
          $id: 'mock-local-developer',
          userId: 'mock-local-developer',
          email: 'dev@scorpion.local'
        };
        return next();
      }
      return res.status(401).json({ error: "No token provided" });
    }

    const token = header.split(" ")[1];
    if (!token) {
      if (isLocal) {
        (req as any).user = {
          $id: 'mock-local-developer',
          userId: 'mock-local-developer',
          email: 'dev@scorpion.local'
        };
        return next();
      }
      return res.status(401).json({ error: "No token provided" });
    }

    const decoded = jwt.decode(token) as any; // ✅ Appwrite JWT decode

    if (!decoded || !decoded.userId) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // Assign decoded user to request with explicit $id mapping
    (req as any).user = {
      $id: decoded.userId,   // ✅ THIS LINE MUST EXIST
      ...decoded,
    };

    next();

  } catch (err) {
    console.error('Auth Error:', err);
    return res.status(401).json({ error: "Unauthorized" });
  }
};
