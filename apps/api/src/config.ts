import "dotenv/config";
import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_PATH: z.string().default("./data/app.db"),
  /**
   * Public origin of the app. In single-origin deploys (API serves the React build
   * behind ngrok), this is the ngrok URL. Used as BetterAuth `baseURL` and as the
   * trusted origin for CSRF.
   */
  APP_BASE_URL: z.string().url(),
  /**
   * Extra trusted origin for CORS (e.g. a separate dev frontend on :5173). Empty
   * in production single-origin mode.
   */
  WEB_ORIGIN: z.string().url().optional(),
  /**
   * Where the built React app lives on disk. If unset, the API runs without
   * static serving (dev mode — Vite handles the UI). In Docker we copy the build
   * into `/app/public`.
   */
  WEB_ROOT: z.string().optional(),
  /**
   * Trust the X-Forwarded-* headers from a reverse proxy (ngrok, Cloudflare).
   * Required for BetterAuth cookies to be issued as Secure behind HTTPS.
   */
  TRUST_PROXY: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .default("false"),
  SESSION_SECRET: z.string().min(16),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("MotoTracker <noreply@example.com>"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  UPLOADS_DIR: z.string().default("./data/uploads"),
  OLLAMA_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_VISION_MODEL: z.string().default("gemma4:26b"),
  OLLAMA_PARSE_MODEL: z.string().optional(),
  OCR_AUTO_APPLY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
  /**
   * Hard ceiling (ms) on a single document's OCR pipeline. Guards against a
   * hung Ollama/Tesseract leaving the document stuck in `pending` forever and
   * stalling the serialized worker queue behind it.
   */
  OCR_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:noreply@mototracker.app"),
  CRON_TIMEZONE: z.string().default("Europe/Istanbul"),
  CRON_HOUR: z.coerce.number().int().min(0).max(23).default(9),
  CRON_ENABLED: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .default("true"),
});

export type AppEnv = z.infer<typeof Env>;

export function loadConfig(env = process.env): AppEnv {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    console.error("Invalid environment:\n" + parsed.error.toString());
    throw new Error("Invalid environment configuration");
  }
  return parsed.data;
}

export const config: AppEnv =
  process.env.NODE_ENV === "test"
    ? loadConfig({
        NODE_ENV: "test",
        WEB_ORIGIN: "http://localhost:5173",
        SESSION_SECRET: "test-secret-test-secret-test-secret",
        APP_BASE_URL: "http://localhost:8787",
        DATABASE_PATH: ":memory:",
        UPLOADS_DIR: "/tmp/mototracker-test-uploads",
        CRON_ENABLED: "false",
        VAPID_PUBLIC_KEY: "BTest_PublicKey_ForTests_Only",
        VAPID_PRIVATE_KEY: "TestPrivateKey_ForTests_Only",
      })
    : loadConfig();
