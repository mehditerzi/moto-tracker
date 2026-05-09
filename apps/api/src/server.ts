import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
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
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: config.WEB_ORIGIN,
      credentials: true,
    }),
  );
  if (!opts.silent && config.NODE_ENV !== "test") {
    app.use(morgan("dev"));
  }

  // BetterAuth must mount BEFORE express.json so it can read raw bodies.
  // Use a request-time handler so tests can reset the db between tests.
  app.all("/api/auth/*", (req, res, next) => {
    toNodeHandler(getAuth())(req, res, next);
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

  app.use(errorHandler);
  return app;
}
