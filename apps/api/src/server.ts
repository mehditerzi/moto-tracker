import express, { type Express, type Request } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";
import { healthRouter } from "./routes/health.js";
import { publicConfigRouter } from "./routes/publicConfig.js";
import { meRouter } from "./routes/me.js";
import { bikesRouter } from "./routes/bikes.js";
import { bikesNestedDatedRouter, datedItemsRouter } from "./routes/datedItems.js";
import { bikesNestedMaintRouter, maintenanceItemsRouter } from "./routes/maintenanceItems.js";
import { notificationPreferencesRouter } from "./routes/notificationPreferences.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { documentsRouter } from "./routes/documents.js";
import { eventsRouter } from "./routes/events.js";
import { tripsRouter } from "./routes/trips.js";
import { mapkitRouter } from "./routes/mapkit.js";
import { rideGroupsRouter } from "./routes/rideGroups.js";
import { fuelLogsRouter } from "./routes/fuelLogs.js";
import { catalogRouter } from "./routes/catalog.js";
import { pushSubscriptionsRouter } from "./routes/pushSubscriptions.js";
import { entitlementRouter } from "./routes/entitlement.js";
import { iapRouter, iapWebhookRouter } from "./routes/iap.js";
import { privacyRouter } from "./routes/privacy.js";
import { orgsRouter } from "./routes/orgs.js";
import { orgInvitesRouter, orgMembersRouter } from "./routes/orgMembers.js";
import { orgFleetRouter } from "./routes/orgFleet.js";
import { orgContractsRouter } from "./routes/orgContracts.js";
import { orgImportRouter } from "./routes/orgImport.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { getAuth } from "./auth/index.js";
import { toNodeHandler } from "better-auth/node";

export interface BuildAppOptions {
  silent?: boolean;
}

/** MapKit JS is script-loaded from Apple's CDN; tiles/search hit sibling hosts. */
const MAPKIT_CDN = "https://cdn.apple-mapkit.com";
const MAPKIT_HOSTS = "https://*.apple-mapkit.com";

/** `capacitor://localhost` and friends have no URL.origin — keep scheme+host. */
function originOf(url: string): string {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.origin : `${u.protocol}//${u.host}`;
  } catch {
    return url;
  }
}

/**
 * Content-Security-Policy for the single-origin deploy (the API serves the
 * React build, user photos and user-supplied text from one origin, so a CSP is
 * the only thing standing between a stored-XSS payload and the session).
 *
 * Scripts need no 'unsafe-inline': the Vite build emits only external hashed
 * modules (dist/index.html carries no inline <script>, just /assets/*.js and
 * /registerSW.js). Styles do need it — Tailwind's runtime-free CSS is fine, but
 * framer-motion animates through inline `style` attributes and MapKit injects
 * its own <style> block, neither of which can be nonce'd.
 */
function cspDirectives(): Record<string, string[] | null> {
  const appOrigins = [config.APP_BASE_URL, config.WEB_ORIGIN]
    .filter((o): o is string => !!o)
    .map(originOf);
  const httpOrigins = appOrigins.filter((o) => o.startsWith("http"));
  // The ride hub speaks WebSocket on our own origin. Safari does not match
  // ws:/wss: against 'self', so the ws origins are listed explicitly.
  const wsOrigins = httpOrigins.map((o) => o.replace(/^http/, "ws"));
  // e.g. capacitor://localhost — the iOS wrapper's own scheme.
  const appSchemes = appOrigins.filter((o) => !o.startsWith("http"));
  // Only meaningful once the public origin is https; forcing it in local dev
  // would rewrite http://localhost:8787 calls to https and break them.
  const httpsOnly = httpOrigins.every((o) => o.startsWith("https"));

  return {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    frameSrc: ["'none'"],
    objectSrc: ["'none'"],
    scriptSrc: ["'self'", MAPKIT_CDN],
    scriptSrcAttr: ["'none'"],
    // See the note above: inline styles are unavoidable here (framer-motion +
    // MapKit). Scripts stay strictly allow-listed, which is what stops XSS.
    styleSrc: ["'self'", "'unsafe-inline'", MAPKIT_CDN],
    // Own photos (/api/bikes/:id/photo, /api/documents/:id/file) are same-origin;
    // blob:/data: cover camera previews; Apple hosts serve the map tiles.
    imgSrc: ["'self'", "data:", "blob:", MAPKIT_HOSTS, ...appSchemes],
    fontSrc: ["'self'", "data:", MAPKIT_CDN],
    mediaSrc: ["'self'", "blob:", "data:"],
    manifestSrc: ["'self'"],
    // MapKit spins up its workers from blob: URLs.
    workerSrc: ["'self'", "blob:"],
    childSrc: ["'self'", "blob:"],
    connectSrc: [
      "'self'",
      ...httpOrigins,
      ...wsOrigins,
      ...appSchemes,
      MAPKIT_CDN,
      MAPKIT_HOSTS,
    ],
    upgradeInsecureRequests: httpsOnly ? [] : null,
  };
}

/**
 * Rate-limit key: the acting user when we can identify them, IP otherwise.
 * These limiters run before the routers' requireUser, so instead of req.user we
 * fingerprint the credential itself (hashed — raw tokens never become map keys).
 * That beats plain IP for mobile clients, which share IPs behind CGNAT.
 */
function userOrIpKey(req: Request): string {
  if (req.user?.id) return `u:${req.user.id}`;
  const cookie = req.headers.cookie ?? "";
  const credential =
    req.headers.authorization ??
    /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]+)/.exec(cookie)?.[1];
  if (credential) return `s:${crypto.createHash("sha256").update(credential).digest("base64url")}`;
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

interface LimitOptions {
  windowMs: number;
  max: number;
  /** Only count these methods; other verbs pass through unmetered. */
  method?: string;
}

/** Limiters are inert under NODE_ENV=test so the suite isn't self-throttling. */
function limiter({ windowMs, max, method }: LimitOptions) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: false,
    legacyHeaders: false,
    message: { error: "too_many_requests" },
    keyGenerator: userOrIpKey,
    skip: (req) => config.NODE_ENV === "test" || (!!method && req.method !== method),
  });
}

export function buildApp(opts: BuildAppOptions = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  if (config.TRUST_PROXY) {
    app.set("trust proxy", true);
  }
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: cspDirectives(),
        // Report-only by default — see CSP_REPORT_ONLY in config.ts for why
        // (a wrong CSP would disable every native plugin at once).
        reportOnly: config.CSP_REPORT_ONLY,
      },
      // Left off deliberately: the iOS wrapper and a dev frontend on :5173 read
      // photos from this origin cross-origin, which same-origin CORP would block.
      crossOriginResourcePolicy: false,
    }),
  );

  // Same-origin in production (web served from API), so CORS is a no-op there.
  // In dev the React app runs at WEB_ORIGIN (e.g. http://localhost:5173).
  const corsOrigins: (string | RegExp)[] = [config.APP_BASE_URL];
  if (config.WEB_ORIGIN) corsOrigins.push(config.WEB_ORIGIN);
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
      // The native app reads its bearer token from this response header on
      // sign-in; it must be exposed for cross-origin (capacitor://localhost) JS.
      exposedHeaders: ["set-auth-token"],
    }),
  );

  if (!opts.silent && config.NODE_ENV !== "test") {
    app.use(morgan("dev"));
  }

  // Rate limit credential submissions only (POST sign-in / sign-up / magic-link).
  // Excludes GET session checks so normal page loads don't drain the quota.
  const authPostLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: false,
    legacyHeaders: false,
    message: { error: "too_many_requests" },
    skip: (req) => req.method !== "POST",
  });
  app.use("/api/auth", authPostLimiter);

  // BetterAuth must mount BEFORE express.json so it can read raw bodies.
  app.all("/api/auth/*", (req, res) => {
    toNodeHandler(getAuth())(req, res);
  });

  app.use(express.json({ limit: "1mb" }));

  // ---- Rate limits on the expensive / abusable surfaces ----
  // Sized well above real usage: a heavy session scans a handful of documents,
  // opens one map, joins one ride and flushes a few telemetry batches.
  // Each upload runs sharp + the full OCR pipeline (Tesseract/Ollama).
  app.use("/api/documents", limiter({ windowMs: 60 * 60 * 1000, max: 60, method: "POST" }));
  // Join codes are 6 chars from a 31-letter alphabet — throttle enumeration.
  app.use("/api/ride-groups/join", limiter({ windowMs: 10 * 60 * 1000, max: 20, method: "POST" }));
  // Mints signed Apple credentials. MapKit re-authorizes near expiry (30 min),
  // so even a long map session needs only a few per hour.
  app.use("/api/mapkit-token", limiter({ windowMs: 60 * 60 * 1000, max: 120 }));
  // Telemetry firehose — batched client-side, one row written per event.
  app.use("/api/events", limiter({ windowMs: 60 * 60 * 1000, max: 300, method: "POST" }));
  // An invite token is a bearer credential (256 bits, so guessing is hopeless) —
  // but the endpoint that redeems one is still the only place in the API where a
  // stranger can submit a secret they might have found, so it is throttled.
  app.use("/api/org-invites", limiter({ windowMs: 15 * 60 * 1000, max: 30, method: "POST" }));

  app.use("/api/health", healthRouter);
  app.use("/api/public-config", publicConfigRouter);
  app.use("/api/me", meRouter);
  app.use("/api/bikes", bikesRouter);
  app.use("/api/bikes", bikesNestedDatedRouter);
  app.use("/api/dated-items", datedItemsRouter);
  app.use("/api/bikes", bikesNestedMaintRouter);
  app.use("/api/maintenance-items", maintenanceItemsRouter);
  app.use("/api/notification-preferences", notificationPreferencesRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/documents", documentsRouter);
  app.use("/api/events", eventsRouter);
  app.use("/api/trips", tripsRouter);
  app.use("/api/mapkit-token", mapkitRouter);
  app.use("/api/ride-groups", rideGroupsRouter);
  app.use("/api/fuel-logs", fuelLogsRouter);
  app.use("/api/catalog", catalogRouter);
  app.use("/api/push", pushSubscriptionsRouter);
  app.use("/api/entitlement", entitlementRouter);
  // Webhook first: it's unauthenticated (Apple → us) and must not hit the
  // requireUser middleware that iapRouter applies to the shared /api/iap path.
  app.use("/api/iap", iapWebhookRouter);
  app.use("/api/iap", iapRouter);

  // ---- Fleet (organizations) ----
  // Five routers on one path so the surface can grow by screen rather than by
  // one enormous file. Order is irrelevant: every path below is distinct, and
  // each router authorises independently through lib/orgAccess.
  app.use("/api/orgs", orgsRouter);
  app.use("/api/orgs", orgMembersRouter);
  app.use("/api/orgs", orgFleetRouter);
  app.use("/api/orgs", orgContractsRouter);
  app.use("/api/orgs", orgImportRouter);
  // Redeeming an invitation is keyed by token, not by org — the caller is not a
  // member yet, so it cannot live under /api/orgs/:orgId.
  app.use("/api/org-invites", orgInvitesRouter);

  // Public, login-free Privacy Policy page (App Store Connect requires a URL
  // reviewers can open without authenticating). Mounted before the SPA static
  // block so /privacy resolves to this page rather than the index.html fallback.
  app.use("/privacy", privacyRouter);

  // ---- Static SPA hosting (single-origin production mode) ----
  // If WEB_ROOT points at a built React dist, serve it and fall back to
  // index.html for any non-/api path so client-side routes work.
  if (config.WEB_ROOT && fs.existsSync(path.join(config.WEB_ROOT, "index.html"))) {
    const root = path.resolve(config.WEB_ROOT);
    // Vite content-hashes everything it emits into /assets, so those URLs are
    // immutable; index.html is the version pointer and must be revalidated on
    // every load or a deploy takes an hour to reach open tabs.
    const IMMUTABLE = "public, max-age=31536000, immutable";
    const NO_CACHE = "no-cache";
    app.use(
      express.static(root, {
        // Set per-file below; the default would otherwise cache index.html too.
        maxAge: 0,
        setHeaders: (res, filePath) => {
          // The service worker must never be cached aggressively.
          if (filePath.endsWith("sw.js") || filePath.endsWith("sw.mjs")) {
            res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
            res.setHeader("Service-Worker-Allowed", "/");
            return;
          }
          if (filePath.endsWith(".webmanifest") || filePath.endsWith("manifest.json")) {
            res.setHeader("Cache-Control", NO_CACHE);
            return;
          }
          if (filePath.endsWith("index.html")) {
            res.setHeader("Cache-Control", NO_CACHE);
            return;
          }
          if (filePath.startsWith(path.join(root, "assets") + path.sep)) {
            res.setHeader("Cache-Control", IMMUTABLE);
            return;
          }
          // Unhashed extras (icons, favicon, registerSW.js): short TTL, since a
          // deploy can change them under the same URL.
          res.setHeader("Cache-Control", "public, max-age=3600");
        },
      }),
    );
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      // cacheControl:false so send() doesn't overwrite the header below.
      res.setHeader("Cache-Control", NO_CACHE);
      res.sendFile(path.join(root, "index.html"), { cacheControl: false });
    });
  }

  app.use(errorHandler);
  return app;
}
