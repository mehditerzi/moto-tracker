import { z } from "zod";

export const maintenanceKindSchema = z.enum([
  "engine_oil",
  "chain",
  "brakes",
  "tires",
  "coolant",
  "custom",
]);
export type MaintenanceKind = z.infer<typeof maintenanceKindSchema>;

export const maintenanceItemSchema = z.object({
  id: z.string(),
  bikeId: z.string(),
  userId: z.string(),
  kind: maintenanceKindSchema,
  customLabel: z.string().nullable(),
  lastDoneOn: z.string().nullable(),
  lastDoneKm: z.number().int().nullable(),
  intervalMonths: z.number().int().nullable(),
  intervalKm: z.number().int().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MaintenanceItem = z.infer<typeof maintenanceItemSchema>;

const dateOpt = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD bekleniyor")
  .nullable()
  .optional();

export const maintenanceCreateSchema = z.object({
  kind: maintenanceKindSchema,
  customLabel: z.string().max(120).nullable().optional(),
  lastDoneOn: dateOpt,
  lastDoneKm: z.number().int().nonnegative().nullable().optional(),
  intervalMonths: z.number().int().positive().nullable().optional(),
  intervalKm: z.number().int().positive().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type MaintenanceCreateInput = z.infer<typeof maintenanceCreateSchema>;

export const maintenanceUpdateSchema = maintenanceCreateSchema.partial();
export type MaintenanceUpdateInput = z.infer<typeof maintenanceUpdateSchema>;
