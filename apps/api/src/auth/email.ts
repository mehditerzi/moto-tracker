import { Resend } from "resend";
import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config.js";

const resend = config.RESEND_API_KEY ? new Resend(config.RESEND_API_KEY) : null;

// Local/self-hosted SMTP fallback (e.g. Mailpit) — only built when no Resend key
// is present and an SMTP host is configured.
const smtp: Transporter | null =
  !resend && config.SMTP_HOST
    ? nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        auth:
          config.SMTP_USER && config.SMTP_PASS
            ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
            : undefined,
      })
    : null;

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Used only for the console.log fallback so the link is easy to spot. */
  devLabel: string;
  devUrl: string;
}

async function send({ to, subject, text, html, devLabel, devUrl }: Mail): Promise<void> {
  if (resend) {
    await resend.emails.send({ from: config.EMAIL_FROM, to, subject, text, html });
    return;
  }
  if (smtp) {
    await smtp.sendMail({ from: config.EMAIL_FROM, to, subject, text, html });
    return;
  }
  console.log(`[email:dev] ${devLabel} for ${to}: ${devUrl}`);
}

export async function sendMagicLinkEmail(to: string, url: string): Promise<void> {
  await send({
    to,
    subject: "Garajım — Giriş bağlantınız",
    text: `Garajım'a giriş yapmak için bu bağlantıya tıklayın:\n\n${url}\n\nBağlantı 15 dakika geçerlidir.`,
    html: `<p>Garajım'a giriş yapmak için aşağıdaki butona tıklayın:</p><p><a href="${url}">Giriş yap</a></p><p>Bağlantı 15 dakika geçerlidir.</p>`,
    devLabel: "magic link",
    devUrl: url,
  });
}

export async function sendPasswordResetEmail(to: string, url: string): Promise<void> {
  await send({
    to,
    subject: "Garajım — Şifre sıfırlama",
    text: `Şifrenizi sıfırlamak için bu bağlantıya tıklayın:\n\n${url}\n\nBağlantı 1 saat geçerlidir. Bu isteği siz yapmadıysanız e-postayı görmezden gelin.`,
    html: `<p>Şifrenizi sıfırlamak için aşağıdaki butona tıklayın:</p><p><a href="${url}">Şifremi sıfırla</a></p><p>Bağlantı 1 saat geçerlidir. Bu isteği siz yapmadıysanız bu e-postayı görmezden gelin.</p>`,
    devLabel: "password reset",
    devUrl: url,
  });
}
