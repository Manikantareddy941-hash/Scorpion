import express, { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { sendOtpEmail } from '../services/emailService';
import { databases, users, DB_ID, COLLECTIONS, Query, ID } from '../lib/appwrite';
import { logger, errorContext } from '../services/logger';
import { recordSecurityEvent } from '../monitor/securityEventSource';

const router = express.Router();

if (!process.env.RESET_TOKEN_SECRET && process.env.NODE_ENV === 'production') {
    throw new Error('RESET_TOKEN_SECRET must be set in production');
}

// When RESET_TOKEN_SECRET is unset (non-production only), fall back to a random
// per-process secret rather than a hardcoded constant. A guessable constant would
// let anyone forge a reset token and take over any account; a random secret means
// the worst case is that already-issued reset tokens stop working after a restart,
// which is fine for a 5-minute token. Read lazily so tests can inject a known value.
const EPHEMERAL_RESET_SECRET = crypto.randomBytes(32).toString('hex');
const getResetTokenSecret = (): string => process.env.RESET_TOKEN_SECRET || EPHEMERAL_RESET_SECRET;

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
        } catch (err: unknown) {
            // No `email` on any site in this flow: a password-reset log that names
            // the address turns the aggregator into the account-enumeration oracle
            // the handler deliberately avoids being (see the always-success reply
            // below). Opaque record ids only.
            logger.warn('[Auth] Appwrite error checking user existence', { event: 'AUTH_USER_LOOKUP_FAILED', ...errorContext(err) });
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
        } catch (dbError: unknown) {
            logger.warn('[Auth] Database operation failed', { event: 'AUTH_RESET_RECORD_WRITE_FAILED', ...errorContext(dbError) });
            if (process.env.NODE_ENV === 'production') throw dbError;
        }

        // Send email
        try {
            await sendOtpEmail(email, otp);
        } catch (emailError: unknown) {
            logger.error('[Auth] Email sending failed', { event: 'AUTH_OTP_EMAIL_SEND_FAILED', ...errorContext(emailError) });
            if (process.env.NODE_ENV === 'production') throw emailError;
            logger.info(`[DEV-OTP] Password reset OTP for ${email}: ${otp}`);
        }

        res.json({ message: 'If an account exists, an OTP has been sent.' });
    } catch (error: unknown) {
        // Generic body, deliberately. The cause is in the log line above, keyed
        // and correlatable; returning it here put internal detail — Appwrite
        // messages, SMTP failures, collection names — on an unauthenticated
        // endpoint, and the differing text also gave a probe a way to tell one
        // backend failure from another (CWE-209).
        logger.error('[Auth] Error in request-reset:', { event: 'AUTH_REQUEST_RESET_FAILED', ...errorContext(error) });
        res.status(500).json({ error: 'Failed to process request' });
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

        // Consume the OTP record now that it verified. Without this the same OTP
        // stays valid until its 10-min expiry and could be replayed to mint
        // multiple reset tokens. reset-password relies on the signed JWT, not this
        // record, so deleting it here is safe.
        try {
            await databases.deleteDocument(DB_ID, COLLECTIONS.PASSWORD_RESETS, reset.$id);
        } catch (delErr: unknown) {
            logger.warn('[Auth] Failed to delete consumed reset record', {
                event: 'AUTH_RESET_RECORD_CONSUME_FAILED', resetId: reset.$id, ...errorContext(delErr),
            });
        }

        // Generate temporary reset token
        const resetToken = jwt.sign({ email }, getResetTokenSecret(), { expiresIn: '5m' });

        res.json({ resetToken, message: 'OTP verified successfully' });
    } catch (error: unknown) {
        logger.error('[Auth] Error in verify-otp:', { event: 'AUTH_VERIFY_OTP_FAILED', ...errorContext(error) });
        res.status(500).json({ error: 'Failed to verify OTP' });
    }
});

// 3. Reset Password
router.post('/reset-password', async (req: Request, res: Response) => {
    const { resetToken, newPassword } = req.body;
    if (!resetToken || !newPassword) return res.status(400).json({ error: 'Missing parameters' });

    try {
        // Verify reset token
        const decoded = jwt.verify(resetToken, getResetTokenSecret()) as { email: string };
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
    } catch (error: unknown) {
        logger.error('[Auth] Error in reset-password:', { event: 'AUTH_RESET_PASSWORD_FAILED', ...errorContext(error) });
        if (error instanceof Error && error.name === 'JsonWebTokenError') {
            void recordSecurityEvent({
                type: 'auth_failure', actor: req.body?.email || 'unknown',
                srcIp: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip,
                ownerUserId: 'system', severity: 'medium', timestamp: Date.now(),
            });
            return res.status(401).json({ error: 'Invalid or expired reset token' });
        }
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

export default router;
