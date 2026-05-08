import { z } from "zod";

export const docTypeSchema = z.enum(["ruhsat", "sigorta", "kasko", "muayene", "unknown"]);
export type DocType = z.infer<typeof docTypeSchema>;

export const ocrStatusSchema = z.enum(["pending", "done", "failed"]);
export type OcrStatus = z.infer<typeof ocrStatusSchema>;

export const ocrExtractedSchema = z.object({
  docType: docTypeSchema,
  plate: z.string().nullable(),
  dates: z.object({
    sigortaExpiresOn: z.string().nullable(),
    kaskoExpiresOn: z.string().nullable(),
    muayeneExpiresOn: z.string().nullable(),
  }),
  confidence: z.number().min(0).max(1),
});
export type OcrExtracted = z.infer<typeof ocrExtractedSchema>;

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
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Document = z.infer<typeof documentSchema>;
