import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { config } from "./config.js";
import { healthRouter } from "./routes/health.js";
import { errorHandler } from "./middleware/errorHandler.js";

export interface BuildAppOptions {
  /** When true, skip request logging and CORS preflight noise (used in tests). */
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

  // BetterAuth handler will be mounted in Task 7 at /api/auth/*
  // before express.json() because it consumes raw bodies for some routes.

  app.use(express.json({ limit: "1mb" }));

  app.use("/api/health", healthRouter);

  app.use(errorHandler);
  return app;
}
