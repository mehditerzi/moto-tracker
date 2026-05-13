import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
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
        // Single-origin same-site requests work with "lax". Behind HTTPS (ngrok),
        // mark cookies Secure so browsers persist them.
        sameSite: "lax",
        secure: isProd,
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
