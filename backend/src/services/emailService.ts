import { Resend } from 'resend';

// Initialize Resend with API key from environment variables
const resend = new Resend(process.env.RESEND_API_KEY);

export const sendOtpEmail = async (email: string, otp: string) => {
  const fromEmail = process.env.EMAIL_FROM || 'onboarding@resend.dev';

  try {
    const { data, error } = await resend.emails.send({
      from: `StackPilot Auth <${fromEmail}>`,
      to: [email],
      subject: 'Your Verification Code',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #1a202c; text-align: center;">Verification Code</h2>
          <p style="color: #4a5568; font-size: 16px;">Hello,</p>
          <p style="color: #4a5568; font-size: 16px;">Your password reset verification code is:</p>
          <div style="background-color: #f7fafc; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #2b6cb0;">${otp}</span>
          </div>
          <p style="color: #718096; font-size: 14px;">This code will expire in 10 minutes.</p>
          <p style="color: #718096; font-size: 14px;">If you did not request this, please ignore this email.</p>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="color: #a0aec0; font-size: 12px; text-align: center;">© 2026 StackPilot</p>
        </div>
      `,
    });

    if (error) {
      throw error;
    }

    console.log(`[Email] OTP sent to ${email} via Resend. ID: ${data?.id}`);
    return { success: true, data };
  } catch (error) {
    console.error(`[Email] Error sending OTP to ${email} via Resend:`, error);

    // In development mode, we still log the OTP so testing isn't blocked by API errors (e.g. invalid key)
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Email-DEV] OTP for ${email} is: ${otp}`);
    }

    return { success: false, error };
  }
};

export const sendCriticalAlertEmail = async (email: string, repoName: string, vulnCount: number, score: number) => {
  const fromEmail = process.env.EMAIL_FROM || 'onboarding@resend.dev';

  try {
    await resend.emails.send({
      from: `StackPilot Security <${fromEmail}>`,
      to: [email],
      subject: `🚨 CRITICAL: ${vulnCount} Security Issues Found in ${repoName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #feb2b2; border-radius: 8px; background-color: #fffaf0;">
          <h2 style="color: #c53030; text-align: center;">Critical Security Alert</h2>
          <p style="color: #2d3748; font-size: 16px;">We detected <strong>${vulnCount}</strong> critical issues during the latest scan of <strong>${repoName}</strong>.</p>
          <div style="background-color: #fff; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0; border: 1px solid #feb2b2;">
            <p style="margin: 0; color: #718096; text-transform: uppercase; font-size: 12px; font-weight: bold;">Security Score</p>
            <span style="font-size: 48px; font-weight: bold; color: #c53030;">${score}/100</span>
          </div>
          <p style="color: #4a5568; font-size: 14px;">Immediate action is required to secure your repository. Please review the findings in the StackPilot Dashboard.</p>
          <div style="text-align: center; margin-top: 30px;">
            <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/security" style="background-color: #2b6cb0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">View Findings</a>
          </div>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="color: #a0aec0; font-size: 12px; text-align: center;">© 2026 StackPilot Security Engine</p>
        </div>
      `,
    });
    console.log(`[Email] Critical alert sent to ${email} for repo ${repoName}`);
  } catch (err) {
    console.error(`[Email] Failed to send critical alert:`, err);
  }
};

export const sendScanCompletionEmail = async (email: string, repoName: string, score: number) => {
  const fromEmail = process.env.EMAIL_FROM || 'onboarding@resend.dev';

  try {
    await resend.emails.send({
      from: `StackPilot <${fromEmail}>`,
      to: [email],
      subject: `Scan Completed: ${repoName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h3 style="color: #2d3748;">Scan Report Available</h3>
          <p style="color: #4a5568;">The automated scan for <strong>${repoName}</strong> has finished successfully.</p>
          <p style="font-size: 18px; color: #2b6cb0;">Health Index: <strong>${score}%</strong></p>
          <p style="color: #718096; font-size: 14px;">Log in to the DevOps Control Center to see the full trend analysis.</p>
          <div style="margin-top: 20px;">
            <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/devops" style="color: #2b6cb0; font-weight: bold; text-decoration: none;">Go to Dashboard →</a>
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.error(`[Email] Failed to send completion email:`, err);
  }
};

