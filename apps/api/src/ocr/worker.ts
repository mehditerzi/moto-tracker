import { getDb } from "../db/index.js";
import { config } from "../config.js";
import {
  runVisionOcr as runVisionOcrDefault,
  runTextOcr as runTextOcrDefault,
  runTextExtract,
} from "./ollamaClient.js";
import { extractTextWithTesseract } from "./tesseractClient.js";
import { parseOcr, type ParsedOcr } from "./parser.js";
import { backstopFromText } from "./backstop.js";
import { validateAndCorrect } from "./validators.js";
import { autoApply } from "./autoApply.js";
import { inferVehicleType } from "./catalog.js";

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

/**
 * Token budget for the verify pass. The verify model is typically a reasoning
 * model whose thinking tokens count against num_predict — it needs headroom a
 * plain parse model must not get (see runTextOcr).
 */
const VERIFY_NUM_PREDICT = 4096;

/** "Unsure" = wouldn't auto-apply: unidentified, or below the apply threshold. */
function isUnsure(p: ParsedOcr): boolean {
  return p.docType === "unknown" || p.confidence < config.OCR_AUTO_APPLY_THRESHOLD;
}

/** A result that identified the document beats one that didn't; then confidence. */
function isBetter(a: ParsedOcr, b: ParsedOcr): boolean {
  if ((a.docType !== "unknown") !== (b.docType !== "unknown")) return a.docType !== "unknown";
  return a.confidence > b.confidence;
}

// Default pipeline: text extraction (dedicated OCR model when configured,
// Tesseract as fallback/default) → text LLM parse → second-opinion parse with
// OLLAMA_VERIFY_MODEL when unsure → vision fallback. Every stage shares the
// caller's AbortSignal (the per-document deadline), so a hung backend is
// actually cancelled — not just abandoned — when the deadline fires.
//
// Vision fallback fires when:
//   • extraction produced too few chars (blurry/unreadable scan)
//   • text LLM threw (network / HTTP error)
//   • the best text parse still couldn't identify the document
//     (doc_type=unknown or confidence<0.3 — typical for garbled output)
async function defaultOcrPipeline(filePath: string, signal: AbortSignal): Promise<OcrResult> {
  let sourceText = "";
  if (config.OLLAMA_OCR_MODEL) {
    try {
      sourceText = (await runTextExtract(filePath, config.OLLAMA_OCR_MODEL, undefined, signal)).trim();
      console.log(`[ocr] ${config.OLLAMA_OCR_MODEL}: ${sourceText.length} chars — first 120: ${sourceText.slice(0, 120).replace(/\n/g, " ")}`);
    } catch (e) {
      if (signal.aborted) throw e;
      console.warn(`[ocr] ${config.OLLAMA_OCR_MODEL} failed — falling back to tesseract:`, (e as Error).message);
    }
  }
  if (sourceText.length < 80) {
    const tesseractText = await extractTextWithTesseract(filePath, signal);
    console.log(`[ocr] tesseract: ${tesseractText.length} chars — first 120: ${tesseractText.slice(0, 120).replace(/\n/g, " ")}`);
    if (tesseractText.length > sourceText.length) sourceText = tesseractText;
  }

  if (sourceText.length >= 80) {
    let result: { rawText: string; model: string } | null = null;
    let parsed: ParsedOcr | null = null;
    try {
      result = await runTextOcrDefault(sourceText, undefined, undefined, signal);
      parsed = parseOcr(result.rawText);
      console.log(`[ocr] text LLM: doc_type=${parsed.docType} confidence=${parsed.confidence} plate=${parsed.plate}`);
    } catch (e) {
      if (signal.aborted) throw e;
      console.warn("[ocr] text LLM failed:", (e as Error).message);
    }

    // Second opinion when the primary parse is unsure — or broke entirely
    // (invalid JSON still lands here rather than skipping straight to vision).
    if ((parsed == null || isUnsure(parsed)) && config.OLLAMA_VERIFY_MODEL) {
      try {
        const second = await runTextOcrDefault(sourceText, config.OLLAMA_VERIFY_MODEL, undefined, signal, VERIFY_NUM_PREDICT);
        const secondParsed = parseOcr(second.rawText);
        console.log(`[ocr] verify LLM (${config.OLLAMA_VERIFY_MODEL}): doc_type=${secondParsed.docType} confidence=${secondParsed.confidence}`);
        if (parsed == null || isBetter(secondParsed, parsed)) {
          result = second;
          parsed = secondParsed;
        }
      } catch (e) {
        if (signal.aborted) throw e;
        console.warn("[ocr] verify LLM failed — keeping primary parse:", (e as Error).message);
      }
    }

    if (result && parsed && parsed.docType !== "unknown" && parsed.confidence >= 0.3) {
      return { ...result, sourceText };
    }
    console.log("[ocr] text parse too uncertain — falling back to vision");
  }

  console.log("[ocr] running vision LLM");
  const vision = await runVisionOcrDefault(filePath, undefined, undefined, signal);
  // Even the vision result gets a second opinion when it's unsure and we have
  // usable text — the big verify model reads garbled receipts better than a
  // general vision model reads blurry photos.
  if (config.OLLAMA_VERIFY_MODEL && sourceText.length >= 80) {
    try {
      const visionParsed = parseOcr(vision.rawText);
      if (isUnsure(visionParsed)) {
        const second = await runTextOcrDefault(sourceText, config.OLLAMA_VERIFY_MODEL, undefined, signal, VERIFY_NUM_PREDICT);
        const secondParsed = parseOcr(second.rawText);
        console.log(`[ocr] verify LLM (post-vision): doc_type=${secondParsed.docType} confidence=${secondParsed.confidence}`);
        if (isBetter(secondParsed, visionParsed)) return { ...second, sourceText };
      }
    } catch (e) {
      if (signal.aborted) throw e;
      console.warn("[ocr] post-vision verify failed — keeping vision result:", (e as Error).message);
    }
  }
  // Keep the extracted text around (if any) so backstops can still recover a
  // plate/date/amount the vision model missed.
  return { ...vision, sourceText: sourceText || undefined };
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

    // Infer car vs motorcycle from the catalog so the review screen shows the
    // right icon and the "create vehicle" path persists the correct type. Null
    // when the make/model is ambiguous — the UI falls back to a neutral default.
    const extracted = { ...parsed, vehicleType: inferVehicleType(parsed.make, parsed.model) };

    db.prepare(
      `UPDATE document
         SET ocr_status = 'done',
             ocr_raw_json = ?,
             ocr_extracted_json = ?,
             doc_type = ?,
             ocr_model = ?,
             bike_id = ?,
             applied_dated_item_id = ?,
             applied_fuel_log_id = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
    ).run(
      rawText,
      JSON.stringify(extracted),
      parsed.docType,
      model,
      newBikeId,
      apply.appliedDatedItemId,
      apply.appliedFuelLogId,
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
