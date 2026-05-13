import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";
import { healthRouter } from "./routes/health.js";
import { meRouter } from "./routes/me.js";
import { bikesRouter } from "./routes/bikes.js";
import { bikesNestedDatedRouter, datedItemsRouter } from "./routes/datedItems.js";
import { bikesNestedMaintRouter, maintenanceItemsRouter } from "./routes/maintenanceItems.js";
import { notificationPreferencesRouter } from "./routes/notificationPreferences.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { documentsRouter } from "./routes/documents.js";
import { pushSubscriptionsRouter } from "./routes/pushSubscriptions.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { getAuth } from "./auth/index.js";
import { toNodeHandler } from "better-auth/node";

export interface BuildAppOptions {
  silent?: boolean;
}

export function buildApp(opts: BuildAppOptions = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  if (config.TRUST_PROXY) {
    app.set("trust proxy", true);
  }
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));

  // Same-origin in production (web served from API), so CORS is a no-op there.
  // In dev the React app runs at WEB_ORIGIN (e.g. http://localhost:5173).
  const corsOrigins: (string | RegExp)[] = [config.APP_BASE_URL];
  if (config.WEB_ORIGIN) corsOrigins.push(config.WEB_ORIGIN);
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
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

  app.use("/api/health", healthRouter);
  app.use("/api/me", meRouter);
  app.use("/api/bikes", bikesRouter);
  app.use("/api/bikes", bikesNestedDatedRouter);
  app.use("/api/dated-items", datedItemsRouter);
  app.use("/api/bikes", bikesNestedMaintRouter);
  app.use("/api/maintenance-items", maintenanceItemsRouter);
  app.use("/api/notification-preferences", notificationPreferencesRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/documents", documentsRouter);
  app.use("/api/push", pushSubscriptionsRouter);

  // ---- Static SPA hosting (single-origin production mode) ----
  // If WEB_ROOT points at a built React dist, serve it and fall back to
  // index.html for any non-/api path so client-side routes work.
  if (config.WEB_ROOT && fs.existsSync(path.join(config.WEB_ROOT, "index.html"))) {
    const root = path.resolve(config.WEB_ROOT);
    app.use(
      express.static(root, {
        maxAge: "1h",
        setHeaders: (res, filePath) => {
          // The service worker must never be cached aggressively.
          if (filePath.endsWith("sw.js") || filePath.endsWith("sw.mjs")) {
            res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
            res.setHeader("Service-Worker-Allowed", "/");
          }
          if (filePath.endsWith(".webmanifest") || filePath.endsWith("manifest.json")) {
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      }),
    );
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(root, "index.html"));
    });
  }

  app.use(errorHandler);
  return app;
}
