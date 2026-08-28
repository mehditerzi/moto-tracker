import { z } from "zod";

export const vehicleTypeSchema = z.enum(["motorcycle", "car"]);
export type VehicleType = z.infer<typeof vehicleTypeSchema>;

export const bikeSchema = z.object({
  id: z.string(),
  /**
   * For a PERSONAL vehicle (`orgId === null`) this is the owner. For an
   * organization vehicle it is only the custodian — the member who registered
   * it — and it must never be used as an access check: visibility comes from
   * org membership (apps/api/src/lib/orgAccess.ts).
   */
  userId: z.string(),
  /**
   * The organization this vehicle belongs to, or null for a personal vehicle.
   * The client needs it to tell a company van apart from the user's own bike —
   * without it here, zod strips the field the API sends and the fleet UI has no
   * way to know which garage a row is in.
   */
  orgId: z.string().nullable(),
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
  fuelType: z.string().max(40).nullable(),
  firstRegistrationDate: z.string().max(10).nullable(),
  // A served API path (e.g. /api/bikes/:id/photo?v=…), not an absolute URL.
  photoUrl: z.string().nullable(),
  archived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Bike = z.infer<typeof bikeSchema>;

/**
 * `orgId` on creation chooses the garage: omitted (or null) creates the vehicle
 * in the caller's personal garage, which is the consumer app and every existing
 * client. Supplying one registers it to that organization, which `POST
 * /api/bikes` allows for an owner or manager only and bills against the org's
 * own ceiling rather than the member's plan.
 *
 * There is deliberately no `orgId` on UPDATE: moving a vehicle between garages
 * changes who can see its whole history and which subscription pays for it, so
 * it is not a field edit. The API ignores it on PATCH.
 */
export const bikeCreateSchema = bikeSchema
  .pick({
    orgId: true,
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
    fuelType: true,
    firstRegistrationDate: true,
  })
  .partial({ orgId: true, vehicleType: true, plate: true, make: true, model: true, year: true, currentKm: true, color: true, chassisNo: true, engineNo: true, cylinderCc: true, fuelType: true, firstRegistrationDate: true });
export type BikeCreateInput = z.infer<typeof bikeCreateSchema>;

export const bikeUpdateSchema = bikeCreateSchema.omit({ orgId: true }).partial();
export type BikeUpdateInput = z.infer<typeof bikeUpdateSchema>;
