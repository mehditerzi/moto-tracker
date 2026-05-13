import { Resend } from "resend";
import { config } from "../config.js";

const resend = config.RESEND_API_KEY ? new Resend(config.RESEND_API_KEY) : null;

export async function sendMagicLinkEmail(to: string, url: string): Promise<void> {
  if (!resend) {
    console.log(`[email:dev] magic link for ${to}: ${url}`);
    return;
  }
  await resend.emails.send({
    from: config.EMAIL_FROM,
    to,
    subject: "MotoTracker — Giriş bağlantınız",
    text: `MotoTracker'a giriş yapmak için bu bağlantıya tıklayın:\n\n${url}\n\nBağlantı 15 dakika geçerlidir.`,
    html: `<p>MotoTracker'a giriş yapmak için aşağıdaki butona tıklayın:</p><p><a href="${url}">Giriş yap</a></p><p>Bağlantı 15 dakika geçerlidir.</p>`,
  });
}

export async function sendPasswordResetEmail(to: string, url: string): Promise<void> {
  if (!resend) {
    console.log(`[email:dev] password reset for ${to}: ${url}`);
    return;
  }
  await resend.emails.send({
    from: config.EMAIL_FROM,
    to,
    subject: "MotoTracker — Şifre sıfırlama",
    text: `Şifrenizi sıfırlamak için bu bağlantıya tıklayın:\n\n${url}\n\nBağlantı 1 saat geçerlidir. Bu isteği siz yapmadıysanız e-postayı görmezden gelin.`,
    html: `<p>Şifrenizi sıfırlamak için aşağıdaki butona tıklayın:</p><p><a href="${url}">Şifremi sıfırla</a></p><p>Bağlantı 1 saat geçerlidir. Bu isteği siz yapmadıysanız bu e-postayı görmezden gelin.</p>`,
  });
}
