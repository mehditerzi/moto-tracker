import { getDb } from "../db/index.js";
import { config } from "../config.js";
import { runVisionOcr as runVisionOcrDefault } from "./ollamaClient.js";
import { parseOcr } from "./parser.js";
import { autoApply } from "./autoApply.js";

interface DocRow {
  id: string;
  user_id: string;
  bike_id: string | null;
  file_path: string;
}

type RunVisionOcr = typeof runVisionOcrDefault;

let _runVisionOcr: RunVisionOcr = runVisionOcrDefault;
export function __setRunVisionOcrForTests(impl: RunVisionOcr): void {
  _runVisionOcr = impl;
}
export function __resetRunVisionOcrForTests(): void {
  _runVisionOcr = runVisionOcrDefault;
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
    const { rawText, model } = await _runVisionOcr(doc.file_path);
    const parsed = parseOcr(rawText);

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
