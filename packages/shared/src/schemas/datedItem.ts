import { z } from "zod";

export const datedItemTypeSchema = z.enum(["sigorta", "kasko", "muayene"]);
export type DatedItemType = z.infer<typeof datedItemTypeSchema>;

export const datedItemSchema = z.object({
  id: z.string(),
  bikeId: z.string(),
  userId: z.string(),
  type: datedItemTypeSchema,
  expiresOn: z.string(),
  provider: z.string().nullable(),
  policyNo: z.string().nullable(),
  cost: z.number().nullable(),
  notes: z.string().nullable(),
  sourceDocumentId: z.string().nullable(),
  ocrConfidence: z.number().nullable(),
  needsReview: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DatedItem = z.infer<typeof datedItemSchema>;

export const datedItemCreateSchema = z.object({
  type: datedItemTypeSchema,
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD bekleniyor"),
  provider: z.string().max(120).nullable().optional(),
  policyNo: z.string().max(80).nullable().optional(),
  cost: z.number().nonnegative().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type DatedItemCreateInput = z.infer<typeof datedItemCreateSchema>;

export const datedItemUpdateSchema = datedItemCreateSchema.partial();
export type DatedItemUpdateInput = z.infer<typeof datedItemUpdateSchema>;

export const dashboardEntrySchema = z.object({
  bike: z.object({
    id: z.string(),
    nickname: z.string(),
    plate: z.string().nullable(),
    make: z.string().nullable(),
    model: z.string().nullable(),
    year: z.number().nullable(),
    color: z.string().nullable(),
    photoUrl: z.string().nullable(),
  }),
  items: z.object({
    sigorta: datedItemSchema.nullable(),
    kasko: datedItemSchema.nullable(),
    muayene: datedItemSchema.nullable(),
  }),
});
export type DashboardEntry = z.infer<typeof dashboardEntrySchema>;
