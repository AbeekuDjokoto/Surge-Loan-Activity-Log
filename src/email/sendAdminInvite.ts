import nodemailer from "nodemailer";

import { env } from "../config/env";
import { logger } from "../logger";

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function buildAdminInviteUrl(rawToken: string): string {
  const base = stripTrailingSlash(env.ADMIN_INVITE_URL_BASE);
  return `${base}?token=${encodeURIComponent(rawToken)}`;
}

/**
 * Sends admin invite link over SMTP or logs the URL when `EMAIL_MODE=console`.
 */
export async function sendAdminInviteEmail(params: {
  to: string;
  rawToken: string;
}): Promise<void> {
  const acceptUrl = buildAdminInviteUrl(params.rawToken);
  const subject = "Administrator invitation";
  const text = `You have been invited as an administrator. Open this link to accept:\n\n${acceptUrl}\n\nIf you did not expect this, you can ignore this message.`;
  const html = `<p>You have been invited as an administrator.</p><p><a href="${acceptUrl}">Accept invitation</a></p><p>If you did not expect this, you can ignore this message.</p>`;

  if (env.EMAIL_MODE === "console") {
    logger.info(
      { to: params.to, acceptUrl },
      "admin invite (EMAIL_MODE=console)"
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
