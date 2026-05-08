import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "validation_error", issues: err.issues });
    return;
  }
  if (err && typeof err === "object" && "status" in err && typeof err.status === "number") {
    res.status(err.status).json({ error: err.message ?? "error" });
    return;
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "internal_error" });
};
