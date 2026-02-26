import express, { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { sendOtpEmail } from '../services/emailService';

const router = express.Router();
const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const RESET_TOKEN_SECRET = process.env.RESET_TOKEN_SECRET || 'your-fallback-secret';

// 1. Request Password Reset
router.post('/request-reset', async (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        // Check if user exists using Supabase Admin API
        const { data: { users }, error: userError } = await supabase.auth.admin.listUsers();

        if (userError) throw userError;

        const user = users.find(u => u.email === email);

        // To prevent email enumeration, we always return success even if user not found
        if (!user) {
            console.log(`[Auth] Reset requested for non-existent email: ${email}`);
            return res.json({ message: 'If an account exists, an OTP has been sent.' });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpHash = await bcrypt.hash(otp, 10);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

        // Save to database
        const { error: resetError } = await supabase
            .from('password_resets')
            .upsert({
                email,
                otp_hash: otpHash,
                expires_at: expiresAt,
                attempts: 0,
                created_at: new Date().toISOString()
            }, { onConflict: 'email' });

        if (resetError) throw resetError;

        // Send email
        await sendOtpEmail(email, otp);

        res.json({ message: 'If an account exists, an OTP has been sent.' });
    } catch (error: any) {
        console.error('[Auth] Error in request-reset:', error);
        res.status(500).json({ error: 'Failed to process request' });
    }
});

// 2. Verify OTP
router.post('/verify-otp', async (req: Request, res: Response) => {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

    try {
        const { data: reset, error: resetError } = await supabase
            .from('password_resets')
            .select('*')
            .eq('email', email)
            .single();

        if (resetError || !reset) {
            return res.status(400).json({ error: 'Invalid or expired OTP' });
        }

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
            await supabase
                .from('password_resets')
                .update({ attempts: reset.attempts + 1 })
                .eq('email', email);

            return res.status(400).json({ error: 'Invalid OTP' });
        }

        // Generate temporary reset token
        const resetToken = jwt.sign({ email }, RESET_TOKEN_SECRET, { expiresIn: '5m' });

        res.json({ resetToken, message: 'OTP verified successfully' });
    } catch (error: any) {
        console.error('[Auth] Error in verify-otp:', error);
        res.status(500).json({ error: 'Failed to verify OTP' });
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

        // Update user password in Supabase Auth
        // We need to fetch user ID first if we're using admin API
        const { data: { users }, error: fetchError } = await supabase.auth.admin.listUsers();
        if (fetchError) throw fetchError;

        const user = users.find(u => u.email === email);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
            password: newPassword
        });

        if (updateError) throw updateError;

        // Delete reset record
        await supabase.from('password_resets').delete().eq('email', email);

        res.json({ message: 'Password updated successfully' });
    } catch (error: any) {
        console.error('[Auth] Error in reset-password:', error);
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid or expired reset token' });
        }
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

export default router;
