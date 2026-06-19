import { getDb } from "../db/index.js";
import { config } from "../config.js";
import { runVisionOcr as runVisionOcrDefault, runTextOcr as runTextOcrDefault } from "./ollamaClient.js";
import { extractTextWithTesseract } from "./tesseractClient.js";
import { parseOcr } from "./parser.js";
import { validateAndCorrect } from "./validators.js";
import { autoApply } from "./autoApply.js";

interface DocRow {
  id: string;
  user_id: string;
  bike_id: string | null;
  file_path: string;
}

type OcrFn = (filePath: string) => Promise<{ rawText: string; model: string }>;

// Default pipeline: Tesseract → text LLM → vision fallback
// Vision fallback fires when:
//   • Tesseract extracted too few chars (blurry/unreadable scan)
//   • text LLM threw (network / HTTP error)
//   • text LLM returned valid JSON but couldn't identify the document
//     (doc_type=unknown or confidence<0.3 — typical for garbled Tesseract output)
async function defaultOcrPipeline(filePath: string): Promise<{ rawText: string; model: string }> {
  const tesseractText = await extractTextWithTesseract(filePath);
  console.log(`[ocr] tesseract: ${tesseractText.length} chars — first 120: ${tesseractText.slice(0, 120).replace(/\n/g, " ")}`);

  if (tesseractText.length >= 80) {
    try {
      const result = await runTextOcrDefault(tesseractText);
      const parsed = parseOcr(result.rawText);
      console.log(`[ocr] text LLM: doc_type=${parsed.docType} confidence=${parsed.confidence} plate=${parsed.plate}`);
      if (parsed.docType !== "unknown" && parsed.confidence >= 0.3) {
        return result;
      }
      console.log("[ocr] text LLM result too uncertain — falling back to vision");
    } catch (e) {
      console.warn("[ocr] text LLM failed — falling back to vision:", (e as Error).message);
    }
  }

  console.log("[ocr] running vision LLM");
  return runVisionOcrDefault(filePath);
}

// Reject if the wrapped promise hasn't settled within `ms`. Used so a hung
// OCR backend can't leave a document stuck in `pending` (and block the queue).
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

let _ocrPipeline: OcrFn = defaultOcrPipeline;

export function __setRunVisionOcrForTests(impl: (filePath: string) => Promise<{ rawText: string; model: string }>): void {
  _ocrPipeline = impl;
}
export function __resetRunVisionOcrForTests(): void {
  _ocrPipeline = defaultOcrPipeline;
}

let _running = Promise.resolve();

export function enqueueDocument(documentId: string): Promise<void> {
  const next = _running.then(() => processDocument(documentId).catch((e) => {
    console.error(`[ocr] document ${documentId} failed:`, e);
  }));
  _running = next;
  return next;
}

export async function processDocument(documentId: string): Promise<void> {
  const db = getDb();
  const doc = db
    .prepare("SELECT id, user_id, bike_id, file_path FROM document WHERE id = ?")
    .get(documentId) as DocRow | undefined;
  if (!doc) return;

  try {
    const { rawText, model } = await withTimeout(
      _ocrPipeline(doc.file_path),
      config.OCR_TIMEOUT_MS,
      "OCR pipeline",
    );
    // Deterministic post-checks: correct provable mistakes (chassis/engine
    // swap, plate normalization) and cap confidence on anything suspect so it
    // won't silently auto-apply.
    const { parsed, issues } = validateAndCorrect(parseOcr(rawText));
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
  }
}
