import express, { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { users, databases, ID, Query, DB_ID } from '../lib/appwrite';
import { sendOtpEmail } from '../services/emailService';

const router = express.Router();

const RESET_TOKEN_SECRET = process.env.RESET_TOKEN_SECRET || 'your-fallback-secret';

// 1. Request Password Reset
router.post('/request-reset', async (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        let userExists = true;

        // Try to check if user exists using Appwrite Users API
        try {
            const userList = await users.list([Query.equal('email', email)]);
            if (userList.total === 0) {
                console.log(`[Auth] Reset requested for non-existent email: ${email}`);
                userExists = false;
            }
        } catch (appwriteError: any) {
            if (process.env.NODE_ENV === 'production') {
                throw appwriteError;
            }
            console.warn('[Auth] Appwrite unreachable, proceeding in dev mode:', appwriteError.message);
            userExists = true;
        }

        // In dev mode, always continue even for non-existent users
        if (!userExists && process.env.NODE_ENV === 'production') {
            return res.json({ message: 'If an account exists, an OTP has been sent.' });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpHash = await bcrypt.hash(otp, 10);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

        // Save to database
        try {
            const existing = await databases.listDocuments(
                DB_ID,
                'password_resets',
                [Query.equal('email', email)]
            );

            const payload = {
                email,
                otp_hash: otpHash,
                expires_at: expiresAt,
                attempts: 0,
                created_at: new Date().toISOString()
            };

            if (existing.total > 0) {
                await databases.updateDocument(DB_ID, 'password_resets', existing.documents[0].$id, payload);
            } else {
                await databases.createDocument(DB_ID, 'password_resets', ID.unique(), payload);
            }
        } catch (dbError: any) {
            console.warn('[Auth] Database save failed:', dbError.message);
            if (process.env.NODE_ENV === 'production') {
                throw dbError;
            }
            console.log('[DEV] Skipping DB save, continuing with OTP send for testing');
        }

        // Send email
        try {
            await sendOtpEmail(email, otp);
        } catch (emailError: any) {
            console.error('[Auth] Email sending failed, but continuing:', emailError.message);
            if (process.env.NODE_ENV === 'production') {
                throw emailError;
            }
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
        const response = await databases.listDocuments(
            DB_ID,
            'password_resets',
            [Query.equal('email', email)]
        );

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
            await databases.updateDocument(
                DB_ID,
                'password_resets',
                reset.$id,
                { attempts: (reset.attempts || 0) + 1 }
            );

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

        // Update user password in Appwrite
        const userList = await users.list([Query.equal('email', email)]);
        if (userList.total === 0) return res.status(404).json({ error: 'User not found' });

        const user = userList.users[0];
        await users.updatePassword(user.$id, newPassword);

        // Delete reset record
        const response = await databases.listDocuments(
            DB_ID,
            'password_resets',
            [Query.equal('email', email)]
        );
        if (response.total > 0) {
            await databases.deleteDocument(DB_ID, 'password_resets', response.documents[0].$id);
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
