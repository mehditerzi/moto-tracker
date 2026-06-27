import { getDb } from "../db/index.js";
import { config } from "../config.js";
import { runVisionOcr as runVisionOcrDefault, runTextOcr as runTextOcrDefault } from "./ollamaClient.js";
import { extractTextWithTesseract } from "./tesseractClient.js";
import { parseOcr } from "./parser.js";
import { backstopFromText } from "./backstop.js";
import { validateAndCorrect } from "./validators.js";
import { autoApply } from "./autoApply.js";

interface DocRow {
  id: string;
  user_id: string;
  bike_id: string | null;
  file_path: string;
}

export interface OcrResult {
  rawText: string;
  model: string;
  /** Raw OCR text (Tesseract), when available — drives deterministic backstops. */
  sourceText?: string;
}

type OcrFn = (filePath: string, signal: AbortSignal) => Promise<OcrResult>;

// Default pipeline: Tesseract → text LLM → vision fallback. Every stage shares
// the caller's AbortSignal (the per-document deadline), so a hung backend is
// actually cancelled — not just abandoned — when the deadline fires.
//
// Vision fallback fires when:
//   • Tesseract extracted too few chars (blurry/unreadable scan)
//   • text LLM threw (network / HTTP error)
//   • text LLM returned valid JSON but couldn't identify the document
//     (doc_type=unknown or confidence<0.3 — typical for garbled Tesseract output)
async function defaultOcrPipeline(filePath: string, signal: AbortSignal): Promise<OcrResult> {
  const tesseractText = await extractTextWithTesseract(filePath, signal);
  console.log(`[ocr] tesseract: ${tesseractText.length} chars — first 120: ${tesseractText.slice(0, 120).replace(/\n/g, " ")}`);

  if (tesseractText.length >= 80) {
    try {
      const result = await runTextOcrDefault(tesseractText, undefined, undefined, signal);
      const parsed = parseOcr(result.rawText);
      console.log(`[ocr] text LLM: doc_type=${parsed.docType} confidence=${parsed.confidence} plate=${parsed.plate}`);
      if (parsed.docType !== "unknown" && parsed.confidence >= 0.3) {
        return { ...result, sourceText: tesseractText };
      }
      console.log("[ocr] text LLM result too uncertain — falling back to vision");
    } catch (e) {
      if (signal.aborted) throw e;
      console.warn("[ocr] text LLM failed — falling back to vision:", (e as Error).message);
    }
  }

  console.log("[ocr] running vision LLM");
  const vision = await runVisionOcrDefault(filePath, undefined, undefined, signal);
  // Keep the Tesseract text around (if any) so backstops can still recover a
  // plate/date the vision model missed.
  return { ...vision, sourceText: tesseractText || undefined };
}

let _ocrPipeline: OcrFn = defaultOcrPipeline;

export function __setRunVisionOcrForTests(impl: (filePath: string, signal?: AbortSignal) => Promise<OcrResult>): void {
  _ocrPipeline = impl as OcrFn;
}
export function __resetRunVisionOcrForTests(): void {
  _ocrPipeline = defaultOcrPipeline;
}

// ── concurrency control ───────────────────────────────────────────────────────
// Per-user serial chains (one user can't run two scans at once, and a slow scan
// never blocks a *different* user) plus a global semaphore that caps total
// parallelism so we don't thrash Tesseract/Ollama.
const userChains = new Map<string, Promise<void>>();

class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async acquire(): Promise<() => void> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.queue.shift()?.();
    };
  }
}
const globalSem = new Semaphore(config.OCR_CONCURRENCY);

/**
 * Queue a document for OCR. Documents from the same user run strictly in order;
 * documents from different users run concurrently up to OCR_CONCURRENCY.
 */
export function enqueueDocument(documentId: string, userId: string): Promise<void> {
  const prev = userChains.get(userId) ?? Promise.resolve();
  const next = prev
    .then(async () => {
      const release = await globalSem.acquire();
      try {
        await processDocument(documentId);
      } catch (e) {
        console.error(`[ocr] document ${documentId} failed:`, e);
      } finally {
        release();
      }
    })
    // Drop the chain entry once it's the tail, so the map doesn't grow forever.
    .finally(() => {
      if (userChains.get(userId) === next) userChains.delete(userId);
    });
  userChains.set(userId, next);
  return next;
}

export async function processDocument(documentId: string): Promise<void> {
  const db = getDb();
  const doc = db
    .prepare("SELECT id, user_id, bike_id, file_path FROM document WHERE id = ?")
    .get(documentId) as DocRow | undefined;
  if (!doc) return;

  // One shared deadline for the whole pipeline. The signal both cancels the
  // in-flight fetch / Tesseract child (cooperative backends) AND, via the race
  // below, guarantees the worker rejects even if a backend ignores the signal
  // entirely — so a hung scan can never leave the document stuck in `pending`.
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`OCR pipeline timed out after ${config.OCR_TIMEOUT_MS}ms`)),
    config.OCR_TIMEOUT_MS,
  );
  const onDeadline = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => reject(controller.signal.reason instanceof Error ? controller.signal.reason : new Error("OCR pipeline aborted")),
      { once: true },
    );
  });

  try {
    const pipeline = _ocrPipeline(doc.file_path, controller.signal);
    // If the pipeline loses the race it may stay pending; swallow its eventual
    // rejection so it doesn't surface as an unhandled rejection.
    pipeline.catch(() => {});
    const { rawText, model, sourceText } = await Promise.race([pipeline, onDeadline]);

    // Deterministic detection backstops over the raw OCR text (fill plate/dates
    // the LLM dropped), then provable post-checks (chassis/engine swap, plate
    // normalization, make/model canonicalization) that cap confidence on doubt.
    const recovered = backstopFromText(parseOcr(rawText), sourceText);
    const { parsed, issues } = validateAndCorrect(recovered);
    if (issues.length > 0) {
      console.log(`[ocr] validators: ${issues.map((i) => `${i.field}:${i.kind}`).join(", ")}`);
    }

    const apply = autoApply({
      db,
      userId: doc.user_id,
      documentId: doc.id,
      bikeIdHint: doc.bike_id,
      parsed,
      threshold: config.OCR_AUTO_APPLY_THRESHOLD,
    });

    // If the doc was uploaded without a bike context but autoApply matched
    // (or created) one, link the document to that bike so the review screen
    // knows which bike to talk about.
    const newBikeId = doc.bike_id ?? apply.appliedBikeId ?? null;

    db.prepare(
      `UPDATE document
         SET ocr_status = 'done',
             ocr_raw_json = ?,
             ocr_extracted_json = ?,
             doc_type = ?,
             ocr_model = ?,
             bike_id = ?,
             applied_dated_item_id = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
    ).run(
      rawText,
      JSON.stringify(parsed),
      parsed.docType,
      model,
      newBikeId,
      apply.appliedDatedItemId,
      doc.id,
    );

    if (apply.bikeAction !== "none") {
      console.log(
        `[ocr] document ${doc.id}: bike ${apply.bikeAction} (id=${apply.appliedBikeId})${
          apply.appliedDatedItemId ? `, dated_item created (${apply.appliedDatedItemId})` : ""
        }`,
      );
    }
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    db.prepare(
      `UPDATE document
         SET ocr_status = 'failed',
             ocr_error = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
    ).run(msg, doc.id);
  } finally {
    clearTimeout(timer);
  }
}
