import nodemailer from "nodemailer";
import { env } from "../lib/env";

function getTransport() {
  if (!env.smtp.host) return null;
  return nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.password } : undefined,
  });
}

export async function sendProtocolEmail(opts: {
  to: string[];
  subject: string;
  html: string;
  attachmentPath?: string;
  attachmentName?: string;
}) {
  const transport = getTransport();
  if (!transport) {
    // SMTP не настроен — не роняем job, просто фиксируем в логах для локальной разработки.
    console.warn("[mailer] SMTP не настроен, письмо не отправлено:", opts.subject, "->", opts.to);
    return { sent: false as const };
  }

  await transport.sendMail({
    from: env.smtp.from,
    to: opts.to.join(", "),
    subject: opts.subject,
    html: opts.html,
    attachments: opts.attachmentPath
      ? [{ filename: opts.attachmentName ?? "protocol.docx", path: opts.attachmentPath }]
      : undefined,
  });
  return { sent: true as const };
}
