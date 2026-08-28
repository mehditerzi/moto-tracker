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

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Used only for the console.log fallback so the link is easy to spot. */
  devLabel: string;
  devUrl: string;
}

async function deliver({ to, subject, text, html, devLabel, devUrl }: Mail): Promise<void> {
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

/**
 * Indirection so the suite can observe what would have been sent.
 *
 * There is no Resend key and no SMTP host in test, so `deliver` would take the
 * console branch and every assertion about mail would be an assertion about
 * stdout. This is the same seam `notify/webPushClient.ts` uses for push, and it
 * exists for the same reason: the transport is the one part of this file we
 * cannot exercise, so it has to be replaceable.
 */
let _send = deliver;

async function send(mail: Mail): Promise<void> {
  await _send(mail);
}

export function __setMailerForTests(impl: (mail: Mail) => Promise<void>): void {
  _send = impl;
}
export function __resetMailerForTests(): void {
  _send = deliver;
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

/**
 * A garage invitation.
 *
 * THE ONLY CHANNEL THAT REACHES THE PERSON BEING INVITED. Everything else this
 * app sends is a push to a device belonging to an account we already have; an
 * invitee may have neither. Until this existed, the inviter had to copy a link
 * out of the app and deliver it by hand, which is not a sharing feature so much
 * as an instruction to build one yourself.
 *
 * Sent to the address whether or not it belongs to an existing account, and the
 * uniformity is load-bearing rather than lazy: `POST /groups/:id/invites` is
 * built so that its behaviour is identical for a registered and an unregistered
 * address, because a route that behaved differently would be a free email
 * enumeration oracle over the whole user base. Branching HERE on account
 * existence would put that oracle back through the side door — one address gets
 * mail and the other does not, and the difference is observable to whoever owns
 * the inbox.
 *
 * The subject and body are composed in notify/messages.ts; see the note there
 * for why they name neither the garage, its vehicles, nor the inviter.
 */
export async function sendGarageInviteEmail(
  to: string,
  mail: { subject: string; text: string; html: string },
  url: string,
): Promise<void> {
  await send({
    to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    devLabel: "garage invite",
    devUrl: url,
  });
}
