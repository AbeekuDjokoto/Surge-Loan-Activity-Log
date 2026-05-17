import nodemailer from "nodemailer";

import { env } from "../config/env";
import { logger } from "../logger";

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function buildPasswordResetUrl(rawToken: string): string {
  const base = stripTrailingSlash(env.PASSWORD_RESET_URL_BASE);
  return `${base}?token=${encodeURIComponent(rawToken)}`;
}

/**
 * Sends password reset email over SMTP or logs the URL when `EMAIL_MODE=console`.
 * In console mode the URL (including token) is logged — for local dev only.
 */
export async function sendPasswordResetEmail(params: {
  to: string;
  rawToken: string;
}): Promise<void> {
  const resetUrl = buildPasswordResetUrl(params.rawToken);
  const subject = "Reset your password";
  const text = `Use this link to reset your password:\n\n${resetUrl}\n\nIf you did not request this, you can ignore this message.`;
  const html = `<p>Use the link below to reset your password.</p><p><a href="${resetUrl}">Reset password</a></p><p>If you did not request this, you can ignore this message.</p>`;

  if (env.EMAIL_MODE === "console") {
    logger.info(
      { to: params.to, resetUrl },
      "password reset (EMAIL_MODE=console)"
    );
    return;
  }

  const port = env.SMTP_PORT ?? 587;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE,
    auth:
      env.SMTP_USER != null &&
      env.SMTP_USER !== "" &&
      env.SMTP_PASS != null &&
      env.SMTP_PASS !== ""
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
  });

  await transport.sendMail({
    from: env.MAIL_FROM,
    to: params.to,
    subject,
    text,
    html,
  });
}
