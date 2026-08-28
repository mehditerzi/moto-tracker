import { z } from "zod";

export const maintenanceKindSchema = z.enum([
  "engine_oil",
  "brakes",
  "tires",
  "battery",
  "coolant",
  "air_filter",
  "chain",
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
  /** What the job cost, in ₺. Null when it was never recorded. */
  cost: z.number().nullable(),
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
  // Service spend in ₺ — the maintenance half of the fleet cost-per-vehicle
  // rollup (docs/fleet-design.md §7.4). Optional and nullable so every client
  // that predates the field keeps working; non-negative because a repair that
  // cost less than nothing is a data-entry slip, not a refund.
  cost: z.number().nonnegative().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type MaintenanceCreateInput = z.infer<typeof maintenanceCreateSchema>;

export const maintenanceUpdateSchema = maintenanceCreateSchema.partial();
export type MaintenanceUpdateInput = z.infer<typeof maintenanceUpdateSchema>;
