import { getDb } from "../db/index.js";
import { config } from "../config.js";
import {
  runVisionOcr as runVisionOcrDefault,
  runTextOcr as runTextOcrDefault,
  runTextExtract,
} from "./ollamaClient.js";
import { extractTextWithTesseract } from "./tesseractClient.js";
import { safeParseOcr, emptyParsedOcr, type ParsedOcr } from "./parser.js";
import { backstopFromText } from "./backstop.js";
import { validateAndCorrect } from "./validators.js";
import { autoApply, suggestBikeForScan } from "./autoApply.js";
import { inferVehicleType } from "./catalog.js";

interface DocRow {
  id: string;
  user_id: string;
  bike_id: string | null;
  file_path: string;
  batch_id: string | null;
}

export interface OcrResult {
  rawText: string;
  model: string;
  /** Raw OCR text (Tesseract), when available — drives deterministic backstops. */
  sourceText?: string;
  /**
   * Which stages actually ran, in order (e.g. `["glm-ocr", "parse", "vision"]`).
   * Production could not answer "did the cheap path win?" because every stage
   * reported the same model name; this makes the route auditable.
   */
  stages?: string[];
}

type OcrFn = (filePath: string, signal: AbortSignal) => Promise<OcrResult>;

/**
 * Token budget for the verify pass. The verify model is typically a reasoning
 * model whose thinking tokens count against num_predict — it needs headroom a
 * plain parse model must not get (see runTextOcr).
 */
const VERIFY_NUM_PREDICT = 4096;

/**
 * Below this many characters, extraction did not read the document — it read
 * a blur. That is the one condition the vision fallback exists for.
 */
const MIN_USABLE_TEXT = 80;

/** "Unsure" = wouldn't auto-apply: unidentified, or below the apply threshold. */
function isUnsure(p: ParsedOcr): boolean {
  return p.docType === "unknown" || p.confidence < config.OCR_AUTO_APPLY_THRESHOLD;
}

/**
 * Did we learn anything at all about this document? Escalation is decided on
 * this, not on the model's self-reported confidence, because the deterministic
 * backstop routinely rescues a plate and an expiry date from text the model
 * shrugged at — and a document with a plate and a date does not need a second,
 * slower model to look at it again.
 */
function foundSomething(p: ParsedOcr): boolean {
  return (
    p.plate != null ||
    p.chassisNo != null ||
    p.dates.muayeneExpiresOn != null ||
    p.dates.sigortaExpiresOn != null ||
    p.dates.kaskoExpiresOn != null
  );
}

/** A result that identified the document beats one that didn't; then confidence. */
function isBetter(a: ParsedOcr, b: ParsedOcr): boolean {
  if ((a.docType !== "unknown") !== (b.docType !== "unknown")) return a.docType !== "unknown";
  return a.confidence > b.confidence;
}

/**
 * THE PIPELINE. Cheap and specific first; escalate only on real doubt.
 *
 *   1. EXTRACT   image → text with the dedicated OCR model (glm-ocr, ~2GB,
 *                ~4s). Tesseract backs it up when the model errors or the
 *                photo defeats it.
 *   2. PARSE     text → JSON with a small text model. Runs on every document,
 *                so it is chosen for latency as much as accuracy.
 *   3. VERIFY    a second, bigger opinion — only when stages 1–2 plus the
 *                deterministic backstop still leave the document unidentified.
 *                Off by default: on the production corpus it never fired.
 *   4. VISION    image → JSON in one shot. ONLY when extraction produced no
 *                usable text, i.e. the photo is unreadable. This is the
 *                expensive path and it is meant to be rare.
 *
 * The previous ordering escalated to vision whenever the parse looked
 * uncertain (`confidence < 0.3`), which sounds prudent and is not: it hands an
 * unreadable-by-assumption image to a general model *after* a purpose-built OCR
 * model has already transcribed it perfectly well. Uncertainty about the
 * CONTENTS is what the backstop and the verify stage are for; the image is only
 * worth re-reading when we could not read it in the first place.
 *
 * Every stage shares the caller's AbortSignal (the per-document deadline), so a
 * hung backend is actually cancelled — not just abandoned — when it fires.
 */
async function defaultOcrPipeline(filePath: string, signal: AbortSignal): Promise<OcrResult> {
  const stages: string[] = [];

  // ── 1. extract ──────────────────────────────────────────────────────────
  let sourceText = "";
  if (config.OLLAMA_OCR_MODEL) {
    try {
      sourceText = (await runTextExtract(filePath, config.OLLAMA_OCR_MODEL, undefined, signal)).trim();
      stages.push(`ocr:${config.OLLAMA_OCR_MODEL}(${sourceText.length})`);
      console.log(`[ocr] ${config.OLLAMA_OCR_MODEL}: ${sourceText.length} chars — first 120: ${sourceText.slice(0, 120).replace(/\n/g, " ")}`);
    } catch (e) {
      if (signal.aborted) throw e;
      stages.push(`ocr:${config.OLLAMA_OCR_MODEL}:ERR`);
      console.warn(`[ocr] ${config.OLLAMA_OCR_MODEL} failed — falling back to tesseract:`, (e as Error).message);
    }
  }
  if (sourceText.length < MIN_USABLE_TEXT) {
    const tesseractText = await extractTextWithTesseract(filePath, signal);
    stages.push(`tesseract(${tesseractText.length})`);
    console.log(`[ocr] tesseract: ${tesseractText.length} chars — first 120: ${tesseractText.slice(0, 120).replace(/\n/g, " ")}`);
    if (tesseractText.length > sourceText.length) sourceText = tesseractText;
  }

  if (sourceText.length >= MIN_USABLE_TEXT) {
    // ── 2. parse ──────────────────────────────────────────────────────────
    let result: { rawText: string; model: string } | null = null;
    let parsed: ParsedOcr | null = null;
    try {
      result = await runTextOcrDefault(sourceText, undefined, undefined, signal);
      const { parsed: p, error } = safeParseOcr(result.rawText);
      parsed = p;
      stages.push(error ? `parse:BADJSON(${error})` : `parse(${p.docType},${p.confidence})`);
      console.log(`[ocr] text LLM: doc_type=${p.docType} confidence=${p.confidence} plate=${p.plate}${error ? ` (unparseable: ${error})` : ""}`);
    } catch (e) {
      if (signal.aborted) throw e;
      stages.push("parse:ERR");
      console.warn("[ocr] text LLM failed:", (e as Error).message);
    }

    // What the deterministic layer makes of the same text. Escalation is judged
    // on this, not on the raw model output — see `foundSomething`.
    const enriched = backstopFromText(parsed ?? emptyParsedOcr(), sourceText);

    // ── 3. verify ─────────────────────────────────────────────────────────
    if (config.OLLAMA_VERIFY_MODEL && isUnsure(enriched)) {
      try {
        const second = await runTextOcrDefault(sourceText, config.OLLAMA_VERIFY_MODEL, undefined, signal, VERIFY_NUM_PREDICT);
        const secondParsed = safeParseOcr(second.rawText).parsed;
        stages.push(`verify(${secondParsed.docType},${secondParsed.confidence})`);
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

    // Keep the text result whenever anything identifiable came out of it —
    // from the model or from the backstop. Re-reading the image would not add
    // information the transcription does not already contain.
    //
    // `result` is null only when the parse call itself failed (network, HTTP);
    // then there is nothing to keep and the image is genuinely worth another
    // look.
    const best = parsed ? backstopFromText(parsed, sourceText) : enriched;
    if (result && (best.docType !== "unknown" || foundSomething(best))) {
      return { ...result, sourceText, stages };
    }
    console.log("[ocr] text yielded nothing identifiable — falling back to vision");
  }

  // ── 4. vision ───────────────────────────────────────────────────────────
  if (!config.OLLAMA_VISION_MODEL) {
    stages.push("vision:disabled");
    // No vision model: hand back whatever text we have. `safeParseOcr` in the
    // worker turns the empty body into an empty parse, and the backstop still
    // gets its shot at the OCR text — a document with no LLM answer at all is
    // worth more than a failed row.
    return { rawText: "", model: "none", sourceText: sourceText || undefined, stages };
  }
  stages.push("vision");
  console.log(`[ocr] running vision LLM (${config.OLLAMA_VISION_MODEL})`);
  try {
    const vision = await runVisionOcrDefault(filePath, undefined, undefined, signal);
    return { ...vision, sourceText: sourceText || undefined, stages };
  } catch (e) {
    if (signal.aborted) throw e;
    // A missing/incapable vision model must not cost the document. Degrade to
    // the text we have; the backstop is the floor, not an optimisation.
    stages.push("vision:ERR");
    console.warn("[ocr] vision LLM failed — degrading to extracted text:", (e as Error).message);
    return { rawText: "", model: config.OLLAMA_VISION_MODEL, sourceText: sourceText || undefined, stages };
  }
}

/** The real pipeline, exported for the eval harness (tests/eval/runEval.ts). */
export const runOcrPipeline = defaultOcrPipeline;

let _ocrPipeline: OcrFn = defaultOcrPipeline;

export function __setRunVisionOcrForTests(impl: (filePath: string, signal?: AbortSignal) => Promise<OcrResult>): void {
  _ocrPipeline = impl as OcrFn;
}
export function __resetRunVisionOcrForTests(): void {
  _ocrPipeline = defaultOcrPipeline;
}

// ── scheduling ────────────────────────────────────────────────────────────────
//
// Three properties, in the order they matter:
//
//   1. PER-USER SERIAL. One user never has two scans running at once. Their
//      documents also complete in the order they were shot, which is what makes
//      "document 3 of 17" mean the third photo the user took.
//   2. FAIR ACROSS USERS. Round-robin: when a slot frees, it goes to the user
//      who has been waiting longest, not to whoever has the most work queued.
//      This is what stops a twenty-document batch from monopolising the box —
//      the previous per-user promise chains got this roughly right by accident
//      (a chain only asked for a slot once its predecessor finished), but only
//      as long as no two users batched at the same time.
//   3. BULK YIELDS TO INTERACTIVE. A batch is reviewed in one sitting minutes
//      from now; a single scan has someone watching a spinner. So a lone upload
//      jumps every queued batch document, at every free slot. It cannot starve
//      the batch — a single user's interactive scan is one document, and their
//      own batch documents queue behind it by rule 1.
//
// The global ceiling stays OCR_CONCURRENCY (default 2): Tesseract and Ollama
// are the scarce resource and over-subscribing them makes everything slower.

export type OcrPriority = "interactive" | "bulk";
const PRIORITY_ORDER: readonly OcrPriority[] = ["interactive", "bulk"] as const;

interface QueuedJob {
  documentId: string;
  priority: OcrPriority;
  settle: () => void;
}

/** userId → the documents they are waiting on, oldest first. */
const queues = new Map<string, QueuedJob[]>();
/** Users with a job running right now — at most one entry each (property 1). */
const running = new Set<string>();
/** Round-robin ring: users with queued work, least-recently-served first. */
const ring: string[] = [];
let active = 0;

/** Pull the next runnable job, honouring priority then round-robin fairness. */
function nextJob(): { userId: string; job: QueuedJob } | null {
  for (const priority of PRIORITY_ORDER) {
    for (let i = 0; i < ring.length; i++) {
      const userId = ring[i]!;
      if (running.has(userId)) continue;
      const q = queues.get(userId);
      // The head is what runs: a user's own documents stay in capture order.
      if (!q || q.length === 0 || q[0]!.priority !== priority) continue;
      const job = q.shift()!;
      // Move this user to the back of the ring — served, so others go first.
      ring.splice(i, 1);
      if (q.length > 0) ring.push(userId);
      else queues.delete(userId);
      return { userId, job };
    }
  }
  return null;
}

function pump(): void {
  while (active < config.OCR_CONCURRENCY) {
    const picked = nextJob();
    if (!picked) return;
    const { userId, job } = picked;
    active++;
    running.add(userId);
    void processDocument(job.documentId)
      .catch((e) => {
        // processDocument already records the failure on the row; this only
        // guards against a defect in the recording itself stalling the queue.
        console.error(`[ocr] document ${job.documentId} failed:`, e);
      })
      .finally(() => {
        active--;
        running.delete(userId);
        job.settle();
        pump();
      });
  }
}

/**
 * Queue a document for OCR. Resolves when that document has been processed
 * (successfully or not) — never rejects, because a failed scan is recorded on
 * the row, not thrown at the uploader who has long since had their 201.
 */
export function enqueueDocument(
  documentId: string,
  userId: string,
  opts: { priority?: OcrPriority } = {},
): Promise<void> {
  return new Promise<void>((resolve) => {
    const job: QueuedJob = {
      documentId,
      priority: opts.priority ?? "interactive",
      settle: resolve,
    };
    const q = queues.get(userId);
    if (q) q.push(job);
    else {
      queues.set(userId, [job]);
      ring.push(userId);
    }
    // Start on a later tick so a burst of uploads inside one request handler is
    // queued in full before the first job takes a slot — otherwise the ring
    // holds one user and "fairness" has nothing to be fair between.
    queueMicrotask(pump);
  });
}

/** Documents queued but not yet started, for a user. Diagnostics and tests. */
export function queueDepth(userId: string): number {
  return queues.get(userId)?.length ?? 0;
}

export async function processDocument(documentId: string): Promise<void> {
  const db = getDb();
  const doc = db
    .prepare("SELECT id, user_id, bike_id, file_path, batch_id FROM document WHERE id = ?")
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
    const { rawText, model, sourceText, stages } = await Promise.race([pipeline, onDeadline]);

    // Deterministic detection backstops over the raw OCR text (fill plate/dates
    // the LLM dropped), then provable post-checks (chassis/engine swap, plate
    // normalization, make/model canonicalization) that cap confidence on doubt.
    //
    // `safeParseOcr`, not `parseOcr`: a model that answered with prose, an empty
    // string or a truncated object used to throw here and fail the document
    // outright — 16% of production scans, every one of them a photo whose plate
    // and expiry date the backstop could have read straight out of the OCR text.
    // A malformed answer now costs the document its LLM fields, not its life.
    const { parsed: modelParsed, error: parseError } = safeParseOcr(rawText);
    if (parseError) {
      console.warn(`[ocr] document ${doc.id}: ${parseError} — falling back to deterministic extraction`);
    }
    const recovered = backstopFromText(modelParsed, sourceText);
    const { parsed, issues } = validateAndCorrect(recovered);

    // A vision-only result has nothing behind it. When stage 1 could not read
    // the photo there is no OCR text for the backstop to check the model
    // against, and a vision model asked to read an unreadable card will invent
    // a plausible answer rather than decline — measured: on one such crop it
    // returned an inspection date belonging to an entirely different document,
    // at high confidence. Uncorroborated, it goes to a human.
    const visionOnly = stages?.includes("vision") === true && !sourceText;
    if (visionOnly && parsed.confidence >= config.OCR_AUTO_APPLY_THRESHOLD) {
      parsed.confidence = Math.min(parsed.confidence, config.OCR_AUTO_APPLY_THRESHOLD - 0.01);
      issues.push({
        field: "confidence",
        kind: "suspect",
        message: "Belge metni okunamadı — değerler doğrulanamadı",
      });
    }

    if (issues.length > 0) {
      console.log(`[ocr] validators: ${issues.map((i) => `${i.field}:${i.kind}`).join(", ")}`);
    }

    // A document in a batch is READ but not APPLIED. The whole point of bulk
    // capture is one human pass over the results: if the worker auto-created a
    // vehicle per confident ruhsat, the review screen would be reporting
    // history instead of asking a question, a single misread plate would have
    // already minted a vehicle, and twenty scans would have spent twenty slots
    // of a paid quota before anyone looked. So we stop at a SUGGESTION and let
    // the batch apply do the writing. See routes/documents.ts.
    const apply = doc.batch_id
      ? { appliedDatedItemId: null, appliedFuelLogId: null, appliedBikeId: null, bikeAction: "none" as const }
      : autoApply({
          db,
          userId: doc.user_id,
          documentId: doc.id,
          bikeIdHint: doc.bike_id,
          parsed,
          threshold: config.OCR_AUTO_APPLY_THRESHOLD,
        });

    let suggestedBikeId: string | null = null;
    if (doc.batch_id) {
      const batch = db.prepare("SELECT org_id FROM document_batch WHERE id = ?").get(doc.batch_id) as
        | { org_id: string | null }
        | undefined;
      const s = suggestBikeForScan(db, doc.user_id, batch?.org_id ?? null, parsed);
      if (s.kind === "update" || s.kind === "org_conflict") suggestedBikeId = s.bikeId;
    }

    // If the doc was uploaded without a bike context but autoApply matched
    // (or created) one, link the document to that bike so the review screen
    // knows which bike to talk about.
    const newBikeId = doc.bike_id ?? apply.appliedBikeId ?? null;

    // Infer car vs motorcycle from the catalog so the review screen shows the
    // right icon and the "create vehicle" path persists the correct type. Null
    // when the make/model is ambiguous — the UI falls back to a neutral default.
    //
    // `issues` travels with the extraction because the review screen needs to
    // point at the two suspect fields; without it a low overall confidence
    // could only say "check everything", which for a ten-field ruhsat is the
    // same as offering no help at all.
    //
    // `pipeline` records the route the document actually took. Production could
    // not answer "did the cheap path win, or did we fall through to vision?",
    // because `ocr_model` names whichever model spoke last and the parse stage
    // was configured from OLLAMA_VISION_MODEL — so every row said "vision" and
    // none of them meant it. One string on the row settles it forever.
    const extracted = {
      ...parsed,
      vehicleType: inferVehicleType(parsed.make, parsed.model),
      issues,
      pipeline: stages?.join(" > "),
    };

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
             suggested_bike_id = ?,
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
      suggestedBikeId,
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
