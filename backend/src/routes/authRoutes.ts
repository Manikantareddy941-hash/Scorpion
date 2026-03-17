import express, { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { sendOtpEmail } from '../services/emailService';
import { databases, users, DB_ID, COLLECTIONS, Query, ID } from '../lib/appwrite';

const router = express.Router();

const RESET_TOKEN_SECRET = process.env.RESET_TOKEN_SECRET || 'your-fallback-secret';

// 1. Request Password Reset
router.post('/request-reset', async (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        let userExists = false;
        let userId = '';

        // Try to check if user exists in Appwrite
        try {
            const userList = await users.list([
                Query.equal('email', email)
            ]);

            if (userList.total > 0) {
                userExists = true;
                userId = userList.users[0].$id;
            }
        } catch (err: any) {
            console.warn('[Auth] Appwrite error checking user existence:', err.message);
            // In dev mode, assume user exists to allow testing
            if (process.env.NODE_ENV !== 'production') {
                userExists = true;
            }
        }

        // To prevent email enumeration, we always return success message even if user not found (unless in dev mode for clarity)
        if (!userExists && process.env.NODE_ENV === 'production') {
            return res.json({ message: 'If an account exists, an OTP has been sent.' });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpHash = await bcrypt.hash(otp, 10);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

        // Check for existing reset record
        try {
            const existingResets = await databases.listDocuments(DB_ID, COLLECTIONS.PASSWORD_RESETS, [
                Query.equal('email', email)
            ]);

            if (existingResets.total > 0) {
                await databases.updateDocument(DB_ID, COLLECTIONS.PASSWORD_RESETS, existingResets.documents[0].$id, {
                    otp_hash: otpHash,
                    expires_at: expiresAt,
                    attempts: 0,
                    updated_at: new Date().toISOString()
                });
            } else {
                await databases.createDocument(DB_ID, COLLECTIONS.PASSWORD_RESETS, ID.unique(), {
                    email,
                    otp_hash: otpHash,
                    expires_at: expiresAt,
                    attempts: 0,
                    created_at: new Date().toISOString()
                });
            }
        } catch (dbError: any) {
            console.warn('[Auth] Database operation failed:', dbError.message);
            if (process.env.NODE_ENV === 'production') throw dbError;
        }

        // Send email
        try {
            await sendOtpEmail(email, otp);
        } catch (emailError: any) {
            console.error('[Auth] Email sending failed:', emailError.message);
            if (process.env.NODE_ENV === 'production') throw emailError;
            console.log(`[DEV-OTP] Password reset OTP for ${email}: ${otp}`);
        }

        res.json({ message: 'If an account exists, an OTP has been sent.' });
    } catch (error: any) {
        console.error('[Auth] Error in request-reset:', error);
        res.status(500).json({ error: error.message || 'Failed to process request' });
    }
});

// 2. Verify OTP
router.post('/verify-otp', async (req: Request, res: Response) => {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

    try {
        const response = await databases.listDocuments(DB_ID, COLLECTIONS.PASSWORD_RESETS, [
            Query.equal('email', email)
        ]);

        if (response.total === 0) {
            return res.status(400).json({ error: 'Invalid or expired OTP' });
        }

        const reset = response.documents[0];

        // Check expiry
        if (new Date() > new Date(reset.expires_at)) {
            return res.status(400).json({ error: 'OTP has expired' });
        }

        // Check attempts
        if (reset.attempts >= 5) {
            return res.status(429).json({ error: 'Too many attempts. Please request a new code.' });
        }

        // Verify OTP
        const isValid = await bcrypt.compare(otp, reset.otp_hash);
        if (!isValid) {
            // Increment attempts
            await databases.updateDocument(DB_ID, COLLECTIONS.PASSWORD_RESETS, reset.$id, {
                attempts: reset.attempts + 1
            });
            return res.status(400).json({ error: 'Invalid OTP' });
        }

        // Generate temporary reset token
        const resetToken = jwt.sign({ email }, RESET_TOKEN_SECRET, { expiresIn: '5m' });

        res.json({ resetToken, message: 'OTP verified successfully' });
    } catch (error: any) {
        console.error('[Auth] Error in verify-otp:', error);
        res.status(500).json({ error: error.message || 'Failed to verify OTP' });
    }
});

// 3. Reset Password
router.post('/reset-password', async (req: Request, res: Response) => {
    const { resetToken, newPassword } = req.body;
    if (!resetToken || !newPassword) return res.status(400).json({ error: 'Missing parameters' });

    try {
        // Verify reset token
        const decoded = jwt.verify(resetToken, RESET_TOKEN_SECRET) as { email: string };
        const email = decoded.email;

        // Fetch user from Appwrite
        const userList = await users.list([
            Query.equal('email', email)
        ]);

        if (userList.total === 0) return res.status(404).json({ error: 'User not found' });
        const user = userList.users[0];

        // Update password in Appwrite
        await users.updatePassword(user.$id, newPassword);

        // Delete reset record
        const response = await databases.listDocuments(DB_ID, COLLECTIONS.PASSWORD_RESETS, [
            Query.equal('email', email)
        ]);
        if (response.total > 0) {
            await databases.deleteDocument(DB_ID, COLLECTIONS.PASSWORD_RESETS, response.documents[0].$id);
        }

        res.json({ message: 'Password updated successfully' });
    } catch (error: any) {
        console.error('[Auth] Error in reset-password:', error);
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid or expired reset token' });
        }
        res.status(500).json({ error: error.message || 'Failed to reset password' });
    }
});

export default router;
