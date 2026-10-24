import { readFile } from "node:fs/promises";
import { config } from "../config.js";
import type { OcrLine } from "./ruhsatLayout.js";

export interface VisionRead {
  text: string;
  lines: OcrLine[];
  ms: number;
}

/**
 * Read an image with the host's Apple Vision service (tools/vision-ocr).
 * A short, hard deadline of its own: this is the fast path, and if it is slow
 * it has failed — the caller falls through to the model pipeline.
 */
export async function readWithVisionService(filePath: string, signal?: AbortSignal): Promise<VisionRead> {
  if (!config.VISION_OCR_URL) throw new Error("vision_ocr_disabled");
  const body = await readFile(filePath);
  const deadline = AbortSignal.timeout(8000);
  const res = await fetch(new URL("/ocr", config.VISION_OCR_URL), {
    method: "POST",
    body,
    headers: { "Content-Type": "application/octet-stream" },
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  });
  if (!res.ok) throw new Error(`vision_ocr_http_${res.status}`);
  const j = (await res.json()) as { lines?: OcrLine[]; ms?: number };
  const lines = sanitizeLines(j.lines);
  return { text: lines.map((l) => l.t).join("\n"), lines, ms: j.ms ?? 0 };
}

/**
 * Lines from any source (host service or a phone) are untrusted input: keep the
 * shape, clamp the numbers, cap the volume. A card has ~80 lines.
 */
export function sanitizeLines(raw: unknown): OcrLine[] {
  if (!Array.isArray(raw)) return [];
  const clamp = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
  return raw
    .slice(0, 600)
    .filter((l): l is Record<string, unknown> => !!l && typeof l === "object" && typeof (l as { t?: unknown }).t === "string")
    .map((l) => ({
      t: String(l.t).slice(0, 300),
      x: clamp(l.x),
      y: clamp(l.y),
      w: clamp(l.w),
      h: clamp(l.h),
    }))
    .filter((l) => l.t.trim().length > 0);
}
