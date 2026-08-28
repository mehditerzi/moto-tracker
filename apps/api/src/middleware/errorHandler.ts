import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import multer from "multer";

/**
 * An error whose message is a stable machine code (`unsupported_media_type`,
 * …) rather than prose. The API ships to a bilingual client, so error bodies
 * must be codes the app can translate — the same convention the routes already
 * follow with `bike_not_found` / `vehicle_limit_reached`. Use this where an
 * error has to travel through third-party middleware (multer's fileFilter)
 * that only lets an Error through.
 */
export class ApiCodeError extends Error {
  readonly status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.name = "ApiCodeError";
    this.status = status;
  }
}

/** multer's own errors carry English prose; map them to codes too. */
const MULTER_CODE: Record<string, { code: string; status: number }> = {
  LIMIT_FILE_SIZE: { code: "file_too_large", status: 413 },
  LIMIT_FILE_COUNT: { code: "too_many_files", status: 400 },
  LIMIT_UNEXPECTED_FILE: { code: "unexpected_file", status: 400 },
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "validation_error", issues: err.issues });
    return;
  }
  // Our own coded errors, including the ones multer re-throws from fileFilter
  // (it decorates them with `storageErrors` but keeps the instance).
  if (err instanceof ApiCodeError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof multer.MulterError || (err instanceof Error && (err as NodeJS.ErrnoException).code === "LIMIT_FILE_SIZE")) {
    const mapped = MULTER_CODE[(err as NodeJS.ErrnoException).code ?? ""];
    res.status(mapped?.status ?? 400).json({ error: mapped?.code ?? "upload_error" });
    return;
  }
  // multer fileFilter rejection (a plain Error thrown in fileFilter)
  if (err instanceof Error && err.message && (err as { storageErrors?: unknown[] }).storageErrors !== undefined) {
    res.status(400).json({ error: "upload_error" });
    return;
  }
  if (err && typeof err === "object" && "status" in err && typeof err.status === "number") {
    res.status(err.status).json({ error: err.message ?? "error" });
    return;
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "internal_error" });
};
