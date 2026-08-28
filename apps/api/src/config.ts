import "dotenv/config";
import { z } from "zod";

/**
 * An Ollama model reference, normalised to an explicit tag.
 *
 * `OLLAMA_VISION_MODEL=gemma4` in production resolved to `gemma4:latest` — an
 * 8B model — while this file's documented default said `gemma4:26b`, a 26B one.
 * Nothing anywhere reported which had actually been loaded, so "the vision
 * model" meant two different things depending on where you looked, and the
 * pipeline was tuned against neither.
 *
 * Normalise rather than reject: an untagged name is legal Ollama input that
 * does work, and refusing to boot over it would take a running deployment down
 * to make a point. Appending `:latest` makes the resolution explicit in logs,
 * in `ocr_model` on every document row, and in this config — which is all that
 * was missing. `loadConfig` warns when it has to do this.
 */
const modelRef = (fallback?: string) =>
  z.preprocess((v) => {
    // Empty string = unset: docker-compose `${VAR:-}` passes "" when absent,
    // and that must land on the default rather than switching the stage off.
    const s = v == null ? "" : String(v).trim();
    if (s === "") return fallback;
    // Explicit opt-out, so a stage can be disabled without knowing a sentinel
    // model name.
    if (/^(none|off|false|0)$/i.test(s)) return undefined;
    return s.includes(":") ? s : `${s}:latest`;
  }, z.string().optional());

/** Was this env var written without a tag? Reported once, at boot. */
export function isUntaggedModelRef(raw: string | undefined): boolean {
  if (!raw) return false;
  const s = raw.trim();
  return s !== "" && !s.includes(":") && !/^(none|off|false|0)$/i.test(s);
}

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
   * Extra trusted origin for CORS (e.g. a separate dev frontend on :5173, or
   * `capacitor://localhost` for the iOS wrapper). Empty in production
   * single-origin mode. An empty string is treated as unset so compose's
   * `${WEB_ORIGIN:-}` default doesn't trip the URL validation on boot.
   */
  WEB_ORIGIN: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().url().optional(),
  ),
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
  EMAIL_FROM: z.string().default("Garajım <noreply@example.com>"),
  /**
   * Local/self-hosted SMTP fallback used when RESEND_API_KEY is unset. Point it
   * at a local catcher (Mailpit: host=localhost, port=1025, no auth) to actually
   * receive magic-link / password-reset mail in dev without an external service.
   * If SMTP_HOST is also unset, email falls back to a console.log of the link.
   */
  SMTP_HOST: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().optional(),
  ),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .default("false"),
  SMTP_USER: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().optional(),
  ),
  SMTP_PASS: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().optional(),
  ),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Sign in with Apple. APPLE_CLIENT_ID is the Service ID (web flow);
  // APPLE_CLIENT_SECRET is the ES256 JWT generated from the .p8 key (rotate
  // every ≤6 months). Both unset → Apple sign-in stays off.
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_CLIENT_SECRET: z.string().optional(),
  UPLOADS_DIR: z.string().default("./data/uploads"),
  OLLAMA_URL: z.string().url().default("http://localhost:11434"),
  /**
   * STAGE 1 — image → text. The whole pipeline is built around this stage
   * winning: a purpose-built OCR model reads a registration card better and an
   * order of magnitude faster than a general model asked to reason about a
   * photo. Measured on the production corpus, glm-ocr:latest reads the plate on
   * 25/25 documents and the inspection date on 23/23 in ~3.7s (see docs/ocr.md).
   *
   * It used to default to unset, i.e. Tesseract-only, which is also how the
   * container shipped — and Tesseract needs `tesseract-ocr-tur` installed to
   * produce anything at all on a Turkish document.
   */
  OLLAMA_OCR_MODEL: modelRef("glm-ocr:latest"),
  /**
   * STAGE 2 — extracted text → structured JSON. This is the hot path: it runs
   * on every document, so its latency is the user's latency.
   *
   * It used to have no default of its own and fell back to OLLAMA_VISION_MODEL,
   * which meant the busiest stage in the pipeline was configured by a variable
   * named after a different one — and every document row recorded the vision
   * model's name whether or not vision had run, which is why production
   * telemetry read as "the vision model handled all 25 documents" when it had
   * in fact handled none of them.
   */
  OLLAMA_PARSE_MODEL: modelRef("gemma4:e2b"),
  /**
   * STAGE 4 (fallback) — image → JSON in one shot, for photos stage 1 could not
   * read at all. Rare, so it may be slower than the hot path — but not
   * unbounded: qwen3.6:35b-mlx blew through a 120s deadline on this task while
   * gemma4:e4b read the same card's plate correctly in 13s.
   *
   * It must actually be able to see. `runVisionOcr` preflights the model's
   * `vision` capability via /api/show and skips the stage rather than spending
   * the whole timeout on a model that will hand back an empty string.
   */
  OLLAMA_VISION_MODEL: modelRef("gemma4:e4b"),
  /**
   * STAGE 4 (escalation) — a second opinion on documents that are genuinely
   * ambiguous: doc_type unknown, or confidence below OCR_AUTO_APPLY_THRESHOLD.
   * Unset → no verification pass, which is the default deliberately. On the
   * production corpus this stage was never once reached, so a large model here
   * costs resident memory and buys nothing; set it only if your documents are
   * harder than that. See docs/ocr.md.
   */
  OLLAMA_VERIFY_MODEL: modelRef(),
  OCR_AUTO_APPLY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
  /**
   * Hard ceiling (ms) on a single document's OCR pipeline. Guards against a
   * hung Ollama/Tesseract leaving the document stuck in `pending` forever and
   * stalling the serialized worker queue behind it.
   */
  OCR_TIMEOUT_MS: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number().int().positive().default(120000),
  ),
  /**
   * Max documents processed concurrently across all users. The worker also
   * serializes per-user, so one user can never have two scans running at once;
   * this caps total parallelism so Tesseract/Ollama don't thrash the box.
   */
  OCR_CONCURRENCY: z.coerce.number().int().positive().default(2),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:noreply@mototracker.app"),
  // APNs (native iOS push). All optional — native push stays off until the
  // four below are set. APNS_KEY is the .p8 contents, PEM or base64-encoded.
  APNS_KEY: z.string().optional(),
  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  APNS_BUNDLE_ID: z.string().optional(),
  APNS_PRODUCTION: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .default("false"),
  // In-App Purchase (auto-renewable subscriptions). Verification is offline by
  // default (Apple root CA chain check, no network). It stays OFF until the root
  // CAs are present and a bundle id is resolvable; then /api/iap/* goes live.
  // IAP_BUNDLE_ID defaults to APNS_BUNDLE_ID (same app), so usually unset.
  IAP_BUNDLE_ID: z.string().optional(),
  // Numeric App Store app id (App Store Connect → App Information → Apple ID).
  // REQUIRED to verify PRODUCTION server notifications; unused in sandbox.
  // Empty string = unset (docker-compose `${VAR:-}` passes "" when absent).
  IAP_APP_APPLE_ID: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number().int().positive().optional(),
  ),
  // Directory of Apple root CA .cer/.der/.pem files (see certs/apple/README.md).
  IAP_APPLE_ROOT_CA_DIR: z.string().default("./certs/apple"),
  // Turn on OCSP online revocation checks (needs outbound network to Apple).
  // Off by default so verification works in locked-down/offline deploys.
  IAP_ENABLE_ONLINE_CHECKS: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .default("false"),
  // MapKit JS (trip route maps). All optional — maps stay hidden until set.
  // MAPKIT_KEY is the .p8 contents (PEM or base64), from a developer-portal key
  // with the MapKit JS service enabled. Team id defaults to APNS_TEAM_ID.
  MAPKIT_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  MAPKIT_KEY_ID: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  MAPKIT_TEAM_ID: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  // The Maps ID the key is associated with (e.g. maps.com.mehditerzi.mototracker).
  // Sent as the token's `sub` claim when set — required by Maps-ID-bound keys.
  MAPKIT_MAPS_ID: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  CRON_TIMEZONE: z.string().default("Europe/Istanbul"),
  CRON_HOUR: z.coerce.number().int().min(0).max(23).default(9),
  CRON_ENABLED: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .default("true"),
  /**
   * How long product telemetry (`event` rows) is kept before the daily prune
   * deletes it. 180 days by default — see notify/retention.ts.
   */
  EVENT_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  /**
   * Send the CSP as `Content-Security-Policy-Report-Only` instead of enforcing
   * it. Defaults to TRUE, deliberately.
   *
   * The iOS wrapper loads the live site through `server.url`, so the phone gets
   * this header from us. Capacitor injects its native bridge as a WKUserScript,
   * which *should* be exempt from page CSP — but if it is not on some WebKit
   * version, a strict `script-src` takes out StoreKit, push and background
   * geolocation simultaneously, on every installed device, with no way to roll
   * back short of a server redeploy.
   *
   * So: ship report-only, watch for violations on a real device, then set
   * CSP_REPORT_ONLY=false to enforce. Report-only still surfaces every
   * violation; it just does not block. See docs/operations.md.
   */
  CSP_REPORT_ONLY: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .default("true"),
  /**
   * Issue the session cookie as SameSite=None; Secure so it is sent on
   * cross-origin requests — required when a native wrapper (Capacitor iOS,
   * origin `capacitor://localhost`) calls this API. Forces Secure (browsers
   * reject SameSite=None without it), so only enable behind HTTPS. Leave off
   * for the same-origin web app, which works with the default Lax.
   */
  CROSS_SITE_COOKIES: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .default("false"),
});

export type AppEnv = z.infer<typeof Env>;

export function loadConfig(env = process.env): AppEnv {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    console.error("Invalid environment:\n" + parsed.error.toString());
    throw new Error("Invalid environment configuration");
  }
  // Say out loud which model each stage actually resolved to. The single most
  // expensive misconfiguration in this pipeline's history was invisible in
  // exactly this spot.
  for (const key of ["OLLAMA_OCR_MODEL", "OLLAMA_PARSE_MODEL", "OLLAMA_VISION_MODEL", "OLLAMA_VERIFY_MODEL"] as const) {
    if (isUntaggedModelRef(env[key])) {
      console.warn(
        `[config] ${key}="${env[key]}" has no tag — resolved to "${parsed.data[key]}". ` +
          `Pin the tag: an untagged name follows whatever :latest points at.`,
      );
    }
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
