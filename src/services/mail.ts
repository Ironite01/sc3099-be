import type { FastifyInstance } from 'fastify';

type ResetMailInput = {
    to: string;
    resetLink: string;
};

export async function sendPasswordResetEmail(fastify: FastifyInstance, input: ResetMailInput): Promise<void> {
    const smtpHost = fastify.config.EMAIL_SMTP_HOST;
    const smtpPort = Number(fastify.config.EMAIL_SMTP_PORT || 587);
    const smtpUser = fastify.config.EMAIL_SMTP_USER;
    const smtpPass = fastify.config.EMAIL_SMTP_PASS;
    const mailFrom = fastify.config.EMAIL_FROM || 'no-reply@saiv.local';

    if (!smtpHost || !smtpUser || !smtpPass) {
        console.warn('[mail] SMTP not configured. Password reset link (dev fallback):');
        console.warn(`[mail] to=${input.to} link=${input.resetLink}`);
        return;
    }

    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
            user: smtpUser,
            pass: smtpPass
        }
    });

    await transporter.sendMail({
        from: mailFrom,
        to: input.to,
        subject: 'SAIV Password Reset',
        text: `Use this link to reset your password: ${input.resetLink}\n\nThis link expires in 15 minutes.`,
        html: `
            <p>You requested a password reset for your SAIV account.</p>
            <p><a href="${input.resetLink}">Reset Password</a></p>
            <p>This link expires in 15 minutes.</p>
            <p>If you did not request this, you can ignore this email.</p>
        `
    });
}
