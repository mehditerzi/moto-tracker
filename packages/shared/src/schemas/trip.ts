import { z } from "zod";

/** Minimum journey length we record. Short hops are ignored as non-trips. */
export const MIN_TRIP_KM = 15;

export const tripSchema = z.object({
  id: z.string(),
  userId: z.string(),
  bikeId: z.string(),
  distanceKm: z.number(),
  startedAt: z.string(),
  endedAt: z.string(),
  pointCount: z.number().int(),
  /** List responses carry only this flag; the detail endpoint has the route. */
  hasRoute: z.boolean().optional(),
  /** Encoded polyline (Google algorithm) — only on GET /api/trips/:id. */
  route: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type Trip = z.infer<typeof tripSchema>;

export const tripCreateSchema = z.object({
  bikeId: z.string().min(1),
  // The ≥15 km rule lives here so the client and server agree on what a trip is.
  distanceKm: z.number().min(MIN_TRIP_KM).max(100000),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1),
  pointCount: z.number().int().nonnegative().default(0),
  // ~1000 simplified points encode well under this; the cap just bounds abuse.
  route: z.string().max(200_000).nullable().optional(),
});
export type TripCreateInput = z.infer<typeof tripCreateSchema>;
