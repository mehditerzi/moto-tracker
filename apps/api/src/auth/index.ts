import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import Database from "better-sqlite3";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import { sendMagicLinkEmail } from "./email.js";

function makeAuth() {
  return betterAuth({
    database: getDb() as unknown as Database.Database,
    baseURL: config.APP_BASE_URL,
    trustedOrigins: [config.WEB_ORIGIN],
    secret: config.SESSION_SECRET,
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
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
