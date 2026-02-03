// lib/email.ts
// Gmail API sender (Google Workspace / Gmail)
//
// Why:
// - SMTP can be unreliable from serverless environments.
// - Gmail API is the most stable way to send mail from a Google mailbox.
//
// Required env vars:
// - GOOGLE_CLIENT_ID
// - GOOGLE_CLIENT_SECRET
// - GOOGLE_REFRESH_TOKEN
// - GOOGLE_EMAIL (the mailbox that owns the refresh token, e.g. hello@krakenfinishes.com)
// - EMAIL_FROM (e.g. 'KrakenVision AI <hello@krakenfinishes.com>')
// Optional:
// - EMAIL_REPLY_TO

import { google } from "googleapis";

function must(name: string, v?: string) {
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function b64url(input: string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getGmail() {
  const clientId = must("GOOGLE_CLIENT_ID", process.env.GOOGLE_CLIENT_ID);
  const clientSecret = must("GOOGLE_CLIENT_SECRET", process.env.GOOGLE_CLIENT_SECRET);
  const refreshToken = must("GOOGLE_REFRESH_TOKEN", process.env.GOOGLE_REFRESH_TOKEN);

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });

  return google.gmail({ version: "v1", auth: oauth2 });
}

type Attachment = {
  filename: string;
  contentType: string;
  contentBase64: string; // standard base64 (not base64url), without data: prefix
};

export async function sendMail(args: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  attachments?: Attachment[];
}) {
  const gmail = await getGmail();
  const from = must("EMAIL_FROM", process.env.EMAIL_FROM);
  const replyTo = args.replyTo || process.env.EMAIL_REPLY_TO || undefined;

  const boundary = `mix_${Math.random().toString(16).slice(2)}`;
  const hasAttachments = Boolean(args.attachments && args.attachments.length);

  let raw = "";
  raw += `From: ${from}\r\n`;
  raw += `To: ${args.to}\r\n`;
  raw += `Subject: ${args.subject}\r\n`;
  if (replyTo) raw += `Reply-To: ${replyTo}\r\n`;
  raw += "MIME-Version: 1.0\r\n";

  if (!hasAttachments) {
    if (args.html) {
      raw += `Content-Type: text/html; charset=UTF-8\r\n\r\n`;
      raw += args.html;
    } else {
      raw += `Content-Type: text/plain; charset=UTF-8\r\n\r\n`;
      raw += args.text || "";
    }
  } else {
    raw += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;

    // Body part
    raw += `--${boundary}\r\n`;
    if (args.html) {
      raw += `Content-Type: text/html; charset=UTF-8\r\n\r\n`;
      raw += `${args.html}\r\n`;
    } else {
      raw += `Content-Type: text/plain; charset=UTF-8\r\n\r\n`;
      raw += `${args.text || ""}\r\n`;
    }

    // Attachments
    for (const att of args.attachments || []) {
      raw += `--${boundary}\r\n`;
      raw += `Content-Type: ${att.contentType}; name="${att.filename}"\r\n`;
      raw += "Content-Transfer-Encoding: base64\r\n";
      raw += `Content-Disposition: attachment; filename="${att.filename}"\r\n\r\n`;
      raw += `${att.contentBase64.replace(/(.{76})/g, "$1\r\n")}\r\n`;
    }

    raw += `--${boundary}--\r\n`;
  }

  const googleEmail = must("GOOGLE_EMAIL", process.env.GOOGLE_EMAIL);

  await gmail.users.messages.send({
    userId: googleEmail,
    requestBody: { raw: b64url(raw) },
  });
}

export async function sendVerificationEmail(args: { to: string; verifyUrl: string }) {
  const verifyUrl = args.verifyUrl;

  const html = `
  <div style="font-family: Arial, system-ui, -apple-system, Segoe UI, sans-serif; line-height: 1.45; color: #111;">
    <h2 style="margin:0 0 8px 0;">Verify your email</h2>
    <p style="margin:0 0 14px 0;">Click the button below to unlock your 3 free KrakenVision AI generations.</p>
    <p style="margin: 18px 0;">
      <a href="${verifyUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700;">
        Verify Email
      </a>
    </p>
    <p style="margin:0;color:#555;font-size:12px;">If you didn’t request this, you can ignore this email.</p>
  </div>`;

  await sendMail({
    to: args.to,
    subject: "Verify your email to unlock KrakenVision AI",
    html,
  });
}
