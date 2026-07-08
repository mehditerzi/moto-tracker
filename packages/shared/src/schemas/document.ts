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
  appliedFuelLogId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Document = z.infer<typeof documentSchema>;
