import { Router } from "express";

export const privacyRouter: Router = Router();

// Last revision of the policy text below. Bump when the content changes.
const LAST_UPDATED = "2026-06-19";
const CONTACT_EMAIL = "mehditerzi32@hotmail.com";

// Self-contained HTML so the page renders with no JS and no app bundle — App
// Review must be able to open the Privacy Policy URL without logging in.
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="all" />
<title>MotoTracker — Privacy Policy</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 2.5rem 1.25rem;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a1a; background: #fafafa;
  }
  main { max-width: 44rem; margin: 0 auto; }
  h1 { font-size: 1.7rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.15rem; margin: 2rem 0 .5rem; }
  .updated { color: #6b7280; font-size: .9rem; margin: 0 0 1.5rem; }
  ul { padding-left: 1.25rem; }
  li { margin: .35rem 0; }
  a { color: #4d7c0f; }
  strong { font-weight: 600; }
  @media (prefers-color-scheme: dark) {
    body { color: #e5e5e5; background: #0a0a0a; }
    .updated { color: #9ca3af; }
    a { color: #a3e635; }
  }
</style>
</head>
<body>
<main>
  <h1>MotoTracker — Privacy Policy</h1>
  <p class="updated">Last updated: ${LAST_UPDATED}</p>

  <p>MotoTracker (&ldquo;the app&rdquo;) helps you track your vehicle documents and
  their expiry dates. This policy explains what data the app collects, why, and how
  it is handled. The service is operated by the app&rsquo;s owner on self-hosted
  infrastructure.</p>

  <h2>What we collect</h2>
  <ul>
    <li><strong>Account information:</strong> your email address (and name, if
    provided) to create and secure your account.</li>
    <li><strong>Vehicle information you enter or scan:</strong> plate, make, model,
    year, chassis number, engine number, cylinder capacity, and document expiry
    dates (insurance / kasko / inspection / maintenance).</li>
    <li><strong>Document photos:</strong> images you capture or upload of your
    vehicle documents. They are processed to read the dates and vehicle details,
    then stored so you can review them.</li>
    <li><strong>Notification token:</strong> if you enable reminders, a push
    token/subscription for your device so we can send expiry reminders.</li>
  </ul>
  <p>We do <strong>not</strong> collect advertising identifiers, location, contacts,
  or browsing activity, and we do not use third-party analytics or advertising SDKs.</p>

  <h2>How your document images are processed</h2>
  <p>Date and field extraction (OCR) runs on the operator&rsquo;s own server
  infrastructure. Document images are <strong>not</strong> sent to third-party
  AI/advertising services for this purpose.</p>

  <h2>How we use your data</h2>
  <ul>
    <li>To provide the core feature: reading, storing, and reminding you about your
    document expiry dates.</li>
    <li>To send the reminder notifications you opt into.</li>
    <li>To authenticate you and keep your account secure.</li>
  </ul>
  <p>We do <strong>not</strong> sell your data or share it with third parties for
  marketing.</p>

  <h2>Third-party services</h2>
  <ul>
    <li><strong>Email delivery</strong> (e.g. for sign-in links / password resets)
    may be sent via a transactional email provider. Only your email address and the
    message are shared, solely to deliver the email.</li>
  </ul>

  <h2>Data retention &amp; deletion</h2>
  <p>Your data is retained while your account is active. You can delete individual
  vehicles, documents, and dated records in the app. To delete your entire account
  and associated data, contact us at the address below and we will remove it.</p>

  <h2>Security</h2>
  <p>Data is transmitted over HTTPS and stored on access-controlled infrastructure.
  Sessions use secure, signed cookies.</p>

  <h2>Children</h2>
  <p>The app is not directed at children under 13 and does not knowingly collect
  their data.</p>

  <h2>Changes</h2>
  <p>We may update this policy; the &ldquo;last updated&rdquo; date above reflects
  the latest revision.</p>

  <h2>Contact</h2>
  <p>Questions or deletion requests:
  <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
</main>
</body>
</html>`;

privacyRouter.get("/", (_req, res) => {
  res.type("html").send(PAGE);
});
