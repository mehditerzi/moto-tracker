import { z } from "zod";
import { vehicleTypeSchema } from "./bike.js";

export const docTypeSchema = z.enum(["ruhsat", "sigorta", "kasko", "muayene", "yakit", "unknown"]);
export type DocType = z.infer<typeof docTypeSchema>;

export const ocrStatusSchema = z.enum(["pending", "done", "failed"]);
export type OcrStatus = z.infer<typeof ocrStatusSchema>;

export const ocrExtractedSchema = z.object({
  docType: docTypeSchema,
  plate: z.string().nullable(),
  // Vehicle details — populated mostly from ruhsat (registration) documents.
  // vehicleType is inferred from the make/model catalog (not read off the page),
  // so the review screen can show the right icon and persist the correct type.
  vehicleType: vehicleTypeSchema.nullable().optional(),
  make: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  firstRegistrationDate: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  chassisNo: z.string().nullable().optional(),
  engineNo: z.string().nullable().optional(),
  cylinderCc: z.number().int().nullable().optional(),
  fuelType: z.string().nullable().optional(),
  dates: z.object({
    sigortaExpiresOn: z.string().nullable(),
    kaskoExpiresOn: z.string().nullable(),
    muayeneExpiresOn: z.string().nullable(),
  }),
  // Pump receipt (yakit) fields — null/absent for other document types.
  fuel: z
    .object({
      filledOn: z.string().nullable(),
      liters: z.number().nullable(),
      totalCost: z.number().nullable(),
      unitPrice: z.number().nullable(),
    })
    .nullable()
    .optional(),
  confidence: z.number().min(0).max(1),
  // Per-field notes from the deterministic post-checks (api ocr/validators.ts).
  // `corrected` = we proved something and fixed it (chassis/engine swapped,
  // make snapped to the catalog); `suspect` = the value is the shape of a
  // mistake and confidence was capped for it. The review screen uses these to
  // point at the two fields worth re-reading instead of asking the user to
  // re-read all ten — which is the difference between a scan that saves time
  // and one that only moves the typing around. Optional: documents scanned
  // before this shipped have no issues array.
  issues: z
    .array(
      z.object({
        field: z.string(),
        kind: z.enum(["corrected", "suspect"]),
        message: z.string(),
      }),
    )
    .optional(),
});
export type OcrExtracted = z.infer<typeof ocrExtractedSchema>;
export type OcrFieldIssue = NonNullable<OcrExtracted["issues"]>[number];

// ─── review decisions ─────────────────────────────────────────────────────────

export const reviewStateSchema = z.enum(["pending", "confirmed", "skipped", "applied"]);
export type ReviewState = z.infer<typeof reviewStateSchema>;

/**
 * What the user decided about one scanned document, saved the moment they tap
 * "confirm" and replayed when the batch is applied.
 *
 * It is deliberately a statement of intent ("create a vehicle with these
 * values") rather than a diff against the OCR result. The scan may be re-read
 * (a retry) between deciding and applying, and a diff would then apply to text
 * the user never saw.
 */
export const reviewDecisionSchema = z.object({
  /**
   * create — mint a new vehicle from `fields`.
   * update — patch the vehicle named by `targetBikeId`.
   * skip   — do nothing with this document. Kept as an explicit decision so
   *          "I looked at it and it is not a ruhsat" is distinguishable from
   *          "I have not got to it yet"; only the first lets the batch apply.
   */
  action: z.enum(["create", "update", "skip"]),
  targetBikeId: z.string().nullable().optional(),
  /** Display name for a created vehicle; ignored for update/skip. */
  nickname: z.string().optional(),
  /** The field values the user settled on. Empty strings mean "leave unset". */
  fields: z
    .object({
      plate: z.string().optional(),
      make: z.string().optional(),
      model: z.string().optional(),
      year: z.string().optional(),
      firstRegistrationDate: z.string().optional(),
      color: z.string().optional(),
      chassisNo: z.string().optional(),
      engineNo: z.string().optional(),
      cylinderCc: z.string().optional(),
      fuelType: z.string().optional(),
    })
    .default({}),
  /** Renewal dates to record alongside the vehicle (ISO yyyy-mm-dd). */
  dates: z
    .object({
      muayene: z.string().optional(),
      sigorta: z.string().optional(),
      kasko: z.string().optional(),
    })
    .default({}),
});
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

export const documentSchema = z.object({
  id: z.string(),
  userId: z.string(),
  bikeId: z.string().nullable(),
  filePath: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  docType: docTypeSchema.nullable(),
  ocrExtracted: ocrExtractedSchema.nullable(),
  ocrStatus: ocrStatusSchema,
  ocrModel: z.string().nullable(),
  ocrError: z.string().nullable(),
  appliedDatedItemId: z.string().nullable(),
  appliedFuelLogId: z.string().nullable(),
  // ─── bulk capture ───────────────────────────────────────────────────────────
  // Null on a single scan, which is still the default path. See migration 025.
  batchId: z.string().nullable().optional(),
  batchSeq: z.number().int().nullable().optional(),
  reviewState: reviewStateSchema.optional(),
  reviewDecision: reviewDecisionSchema.nullable().optional(),
  /** Existing vehicle this scan appears to be about (plate/chassis match). */
  suggestedBikeId: z.string().nullable().optional(),
  /**
   * What the server proposes doing with this scan, recomputed when a batch is
   * read rather than frozen at OCR time — applying document 4 changes the right
   * answer for document 11 if they are two photos of the same vehicle.
   */
  suggestion: z.enum(["create", "update", "org_conflict", "none"]).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Document = z.infer<typeof documentSchema>;

// ─── batches ──────────────────────────────────────────────────────────────────

export const batchStatusSchema = z.enum(["open", "applied", "discarded"]);
export type BatchStatus = z.infer<typeof batchStatusSchema>;

export const documentBatchSchema = z.object({
  id: z.string(),
  userId: z.string(),
  /** Target garage: null = personal, set = this organization's fleet. */
  orgId: z.string().nullable(),
  status: batchStatusSchema,
  appliedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Live counts, computed server-side — the honest "12 of 17 read" header. */
  progress: z.object({
    total: z.number().int(),
    pending: z.number().int(),
    done: z.number().int(),
    failed: z.number().int(),
    /** Documents the user has confirmed or deliberately skipped. */
    decided: z.number().int(),
  }),
});
export type DocumentBatch = z.infer<typeof documentBatchSchema>;

export const documentBatchDetailSchema = z.object({
  batch: documentBatchSchema,
  documents: z.array(documentSchema),
});
export type DocumentBatchDetail = z.infer<typeof documentBatchDetailSchema>;
