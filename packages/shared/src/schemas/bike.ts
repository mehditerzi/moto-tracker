import { z } from "zod";

export const vehicleTypeSchema = z.enum(["motorcycle", "car"]);
export type VehicleType = z.infer<typeof vehicleTypeSchema>;

export const bikeSchema = z.object({
  id: z.string(),
  userId: z.string(),
  vehicleType: vehicleTypeSchema,
  nickname: z.string().min(1).max(80),
  plate: z.string().max(20).nullable(),
  make: z.string().max(60).nullable(),
  model: z.string().max(60).nullable(),
  year: z.number().int().min(1900).max(2100).nullable(),
  currentKm: z.number().int().min(0).nullable(),
  color: z.string().max(40).nullable(),
  chassisNo: z.string().max(30).nullable(),
  engineNo: z.string().max(30).nullable(),
  cylinderCc: z.number().int().min(0).nullable(),
  photoUrl: z.string().url().nullable(),
  archived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Bike = z.infer<typeof bikeSchema>;

export const bikeCreateSchema = bikeSchema
  .pick({
    vehicleType: true,
    nickname: true,
    plate: true,
    make: true,
    model: true,
    year: true,
    currentKm: true,
    color: true,
    chassisNo: true,
    engineNo: true,
    cylinderCc: true,
  })
  .partial({ vehicleType: true, plate: true, make: true, model: true, year: true, currentKm: true, color: true, chassisNo: true, engineNo: true, cylinderCc: true });
export type BikeCreateInput = z.infer<typeof bikeCreateSchema>;

export const bikeUpdateSchema = bikeCreateSchema.partial();
export type BikeUpdateInput = z.infer<typeof bikeUpdateSchema>;
