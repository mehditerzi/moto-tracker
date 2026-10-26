import { Router } from "express";

/**
 * The App Store "Support URL" (Guideline 1.5): a public page where a user can
 * find answers and reach a person. App Review rejected 1.4 because the support
 * URL pointed at the app itself, which shows a login screen.
 *
 * Self-contained HTML like /privacy — no JS, no bundle, no login — in Turkish
 * first (the audience) with an English section below.
 */
export const supportRouter: Router = Router();

const CONTACT_EMAIL = "mehditerzi32@hotmail.com";
const MANAGE_SUBS = "https://apps.apple.com/account/subscriptions";
const REFUND = "https://reportaproblem.apple.com";

const PAGE = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Garajım — Destek / Support</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 2.5rem 1.25rem 4rem;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a1a; background: #fafafa; }
  main { max-width: 44rem; margin: 0 auto; }
  header { display: flex; align-items: center; gap: .9rem; margin-bottom: 1.5rem; }
  .logo { width: 52px; height: 52px; border-radius: 14px; background: #0B0B0E; display: grid; place-items: center; }
  .logo span { color: #E1FF4D; font-weight: 800; font-size: 1.4rem; }
  h1 { font-size: 1.7rem; margin: 0; }
  h2 { font-size: 1.2rem; margin: 2.25rem 0 .5rem; }
  h3 { font-size: 1rem; margin: 1.4rem 0 .25rem; }
  p { margin: .4rem 0; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 1.1rem 1.25rem; margin: 1rem 0; }
  .btn { display: inline-block; background: #0B0B0E; color: #E1FF4D; text-decoration: none; font-weight: 600;
    padding: .7rem 1.1rem; border-radius: 12px; margin-top: .5rem; }
  .muted { color: #6b7280; font-size: .92rem; }
  a { color: #4d7c0f; }
  hr { border: 0; border-top: 1px solid #e5e7eb; margin: 3rem 0 0; }
  @media (prefers-color-scheme: dark) {
    body { color: #e5e5e5; background: #0a0a0a; }
    .card { background: #141418; border-color: #26262c; }
    .muted { color: #9ca3af; }
    a { color: #a3e635; }
    hr { border-color: #26262c; }
  }
</style>
</head>
<body>
<main>
  <header>
    <div class="logo"><span>G</span></div>
    <div><h1>Garajım Destek</h1><p class="muted">Araç takip, bakım ve masraf asistanı</p></div>
  </header>

  <div class="card">
    <strong>Bize ulaşın</strong>
    <p>Sorun, öneri ya da hesap talepleriniz için e-posta gönderin. Genellikle 1 iş günü içinde yanıtlıyoruz.</p>
    <a class="btn" href="mailto:${CONTACT_EMAIL}?subject=Garaj%C4%B1m%20Destek">${CONTACT_EMAIL}</a>
    <p class="muted">Mümkünse telefon modelinizi, iOS sürümünü ve sorunun ekran görüntüsünü ekleyin.</p>
  </div>

  <h2>Sık sorulan sorular</h2>

  <h3>Belge tarama tarihleri okumuyor</h3>
  <p>Ruhsatı ya da poliçeyi düz bir zemine koyun, ışığın yansımadığından emin olun ve belgenin tamamı kadraja girsin. Okunan alanları kaydetmeden önce inceleme ekranında düzeltebilirsiniz.</p>

  <h3>Hatırlatma bildirimleri gelmiyor</h3>
  <p>iPhone Ayarlar &rsaquo; Bildirimler &rsaquo; Garajım bölümünden bildirimlere izin verin. Uygulamada Ayarlar &rsaquo; Bildirimler ekranından hangi tarihlerin kaç gün önce hatırlatılacağını seçebilir, &ldquo;Test gönder&rdquo; ile deneyebilirsiniz.</p>

  <h3>Garajım Pro aboneliğimi nasıl yönetir ya da iptal ederim?</h3>
  <p>Abonelikler Apple Kimliğinize bağlıdır: iPhone Ayarlar &rsaquo; [adınız] &rsaquo; Abonelikler &rsaquo; Garajım, ya da <a href="${MANAGE_SUBS}">${MANAGE_SUBS}</a>. Uygulamada Ayarlar &rsaquo; Abonelik &rsaquo; &ldquo;Aboneliği yönet&rdquo; aynı sayfayı açar. İptal, mevcut dönemin sonunda geçerli olur.</p>

  <h3>İade almak istiyorum</h3>
  <p>App Store üzerinden yapılan ödemelerin iadesini Apple değerlendirir: <a href="${REFUND}">${REFUND}</a>.</p>

  <h3>Yeni telefona geçtim, Pro görünmüyor</h3>
  <p>Aynı hesapla giriş yapın; gerekirse Pro ekranındaki &ldquo;Satın alımları geri yükle&rdquo; düğmesine dokunun.</p>

  <h3>Hesabımı ve verilerimi nasıl silerim?</h3>
  <p>Uygulamada Ayarlar &rsaquo; Hesabı sil. Hesabınız, araçlarınız, belgeleriniz ve kayıtlarınız kalıcı olarak silinir. Uygulamaya erişemiyorsanız kayıtlı e-posta adresinizden bize yazın.</p>

  <h3 id="topluluk">Topluluk kuralları</h3>
  <p>Garajım'ın sosyal özellikleri (profil, akış, yorumlar, grup sürüşleri) saygı çerçevesinde kullanılmalıdır. Hakaret, taciz, nefret söylemi, müstehcenlik, spam, tehlikeli/yasadışı sürüşü özendirme ve başkalarının kişisel bilgilerini paylaşmak yasaktır; bu tür içeriklere tolerans gösterilmez. Uygunsuz içeriği ya da kişiyi uygulama içinden &ldquo;Bildir&rdquo; ile bildirebilir, &ldquo;Engelle&rdquo; ile tamamen gizleyebilirsiniz. Bildirimler 24 saat içinde incelenir; kuralları ihlal eden içerik kaldırılır, hesaplar kapatılabilir.</p>

  <h3>Verilerim nerede, kimlerle paylaşılıyor?</h3>
  <p>Verileriniz satılmaz ve reklam amacıyla paylaşılmaz. Ayrıntılar <a href="/privacy">Gizlilik Politikası</a>&rsquo;nda.</p>

  <hr />

  <h2 lang="en">Support (English)</h2>
  <div lang="en">
    <p>Email <a href="mailto:${CONTACT_EMAIL}?subject=Garaj%C4%B1m%20Support">${CONTACT_EMAIL}</a> — we usually reply within one business day. Please include your device model, iOS version and a screenshot.</p>
    <h3>Manage or cancel Garajım Pro</h3>
    <p>Settings &rsaquo; [your name] &rsaquo; Subscriptions &rsaquo; Garajım, or <a href="${MANAGE_SUBS}">${MANAGE_SUBS}</a>. In the app: Settings &rsaquo; Subscription &rsaquo; Manage subscription. Cancellation takes effect at the end of the current period.</p>
    <h3>Refunds</h3>
    <p>Refunds for App Store purchases are handled by Apple: <a href="${REFUND}">${REFUND}</a>.</p>
    <h3>Restore purchases</h3>
    <p>Sign in with the same account and tap &ldquo;Restore purchases&rdquo; on the Pro screen.</p>
    <h3>Community rules</h3>
    <p>No harassment, hate speech, sexual content, spam, encouraging dangerous or illegal riding, or sharing other people's personal information — zero tolerance. Report content or people from inside the app, or block them. Reports are reviewed within 24 hours; violating content is removed and accounts may be closed.</p>
    <h3>Delete your account</h3>
    <p>In the app: Settings &rsaquo; Delete account. This permanently deletes your account and all your data. See the <a href="/privacy">Privacy Policy</a>.</p>
  </div>
</main>
</body>
</html>`;

supportRouter.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(PAGE);
});
