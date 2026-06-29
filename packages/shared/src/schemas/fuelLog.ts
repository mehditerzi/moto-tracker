import { z } from "zod";

export const fuelLogSchema = z.object({
  id: z.string(),
  userId: z.string(),
  bikeId: z.string(),
  filledOn: z.string(),
  liters: z.number(),
  totalCost: z.number().nullable(),
  odometerKm: z.number().int().nullable(),
  isFull: z.boolean(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});
export type FuelLog = z.infer<typeof fuelLogSchema>;

export const fuelLogCreateSchema = z.object({
  bikeId: z.string().min(1),
  filledOn: z.string().min(1),
  liters: z.number().positive().max(1000),
  totalCost: z.number().nonnegative().max(1_000_000).nullable().optional(),
  odometerKm: z.number().int().nonnegative().max(10_000_000).nullable().optional(),
  isFull: z.boolean().default(true),
  notes: z.string().max(500).nullable().optional(),
});
export type FuelLogCreateInput = z.infer<typeof fuelLogCreateSchema>;
