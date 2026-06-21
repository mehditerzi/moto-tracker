import { betterAuth } from "better-auth";
import { magicLink, bearer } from "better-auth/plugins";
import Database from "better-sqlite3";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import { sendMagicLinkEmail, sendPasswordResetEmail } from "./email.js";

function makeAuth() {
  const isProd = config.NODE_ENV === "production";
  // Always trust the configured public origin + an optional separate web origin.
  // Also unconditionally trust the local loopback bound port — only this host
  // can reach it, so it's safe, and it makes direct API testing not 403.
  const trustedOrigins = new Set<string>([
    config.APP_BASE_URL,
    `http://localhost:${config.PORT}`,
    `http://127.0.0.1:${config.PORT}`,
  ]);
  if (config.WEB_ORIGIN) trustedOrigins.add(config.WEB_ORIGIN);

  return betterAuth({
    database: getDb() as unknown as Database.Database,
    baseURL: config.APP_BASE_URL,
    trustedOrigins: [...trustedOrigins],
    secret: config.SESSION_SECRET,
    advanced: {
      defaultCookieAttributes: {
        // Same-origin web works with "lax". When the API serves a cross-origin
        // native wrapper (Capacitor iOS, origin capacitor://localhost), the
        // cookie must be SameSite=None; Secure or WKWebView won't send it.
        // SameSite=None requires Secure, so force it on in that mode.
        sameSite: config.CROSS_SITE_COOKIES ? "none" : "lax",
        secure: config.CROSS_SITE_COOKIES ? true : isProd,
      },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      sendResetPassword: async ({ user, url }) => {
        await sendPasswordResetEmail(user.email, url);
      },
    },
    socialProviders:
      config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: config.GOOGLE_CLIENT_ID,
              clientSecret: config.GOOGLE_CLIENT_SECRET,
            },
          }
        : undefined,
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await sendMagicLinkEmail(email, url);
        },
        expiresIn: 15 * 60, // 15 minutes
      }),
      // Native (Capacitor iOS) can't rely on the cross-site session cookie —
      // WKWebView drops it — so the app authenticates with a bearer token
      // instead. The token is returned in the `set-auth-token` response header
      // on sign-in and accepted as `Authorization: Bearer …` on every request.
      bearer(),
    ],
  });
}

// In production the module is loaded once, so we keep a cached instance.
// In tests, buildTestApp() calls resetDbForTests() which closes+replaces the
// db singleton, then calls buildApp() — so the handler re-creates auth each
// request to pick up the fresh db connection.
let _auth: ReturnType<typeof makeAuth> | null = null;

export function getAuth() {
  if (config.NODE_ENV === "test") {
    // Always create fresh in tests so we use the current db instance.
    return makeAuth();
  }
  if (!_auth) {
    _auth = makeAuth();
  }
  return _auth;
}

export type Auth = ReturnType<typeof makeAuth>;
