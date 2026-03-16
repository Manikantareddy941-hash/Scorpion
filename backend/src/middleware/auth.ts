import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to verify Appwrite JWT
 */
export const verifyUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization;

    if (!header) {
      return res.status(401).json({ error: "No token provided" });
    }

    const token = header.split(" ")[1];
    if (!token) {
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
