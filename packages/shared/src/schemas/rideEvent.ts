import { z } from "zod";

/**
 * Planned group rides ("Sürüş planla"): a dated meet-up friends join through an
 * invite link. Different from a live ride group (ride.ts), which is the
 * real-time map room — a planned ride turns into one when its organiser taps
 * "Start" on the day.
 */

export const RIDE_PACES = ["relaxed", "steady", "brisk"] as const;
export const ridePaceSchema = z.enum(RIDE_PACES);
export type RidePace = z.infer<typeof ridePaceSchema>;

export const RIDE_EVENT_KINDS = ["any", "motorcycle", "car"] as const;
export const rideEventKindSchema = z.enum(RIDE_EVENT_KINDS);
export type RideEventKind = z.infer<typeof rideEventKindSchema>;

export const RSVP_STATUSES = ["going", "maybe"] as const;
export const rsvpStatusSchema = z.enum(RSVP_STATUSES);
export type RsvpStatus = z.infer<typeof rsvpStatusSchema>;

/** A named point. Coordinates are optional — "Kadıköy iskele önü" is enough. */
export const rideEventPlaceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});
export type RideEventPlace = z.infer<typeof rideEventPlaceSchema>;

export const rideEventInputSchema = z.object({
  title: z.string().trim().min(2).max(80),
  note: z.string().trim().max(500).nullable().optional(),
  /** ISO-8601 with offset/Z. */
  startsAt: z.string().datetime({ offset: true }),
  meet: rideEventPlaceSchema,
  destination: rideEventPlaceSchema.nullable().optional(),
  distanceKm: z.number().min(1).max(5000).nullable().optional(),
  pace: ridePaceSchema.default("relaxed"),
  vehicleKind: rideEventKindSchema.default("any"),
  maxRiders: z.number().int().min(2).max(500).nullable().optional(),
});
export type RideEventInput = z.infer<typeof rideEventInputSchema>;

export const rsvpInputSchema = z.object({
  status: rsvpStatusSchema,
  bikeId: z.string().nullable().optional(),
});
export type RsvpInput = z.infer<typeof rsvpInputSchema>;

export interface RideEventRider {
  userId: string;
  name: string;
  status: RsvpStatus;
  isOwner: boolean;
  /** "Yamaha MT-09" — what they are bringing, when they said. */
  vehicle: string | null;
}

export interface RideEvent {
  id: string;
  code: string;
  title: string;
  note: string | null;
  startsAt: string;
  meet: RideEventPlace;
  destination: RideEventPlace | null;
  distanceKm: number | null;
  pace: RidePace;
  vehicleKind: RideEventKind;
  maxRiders: number | null;
  ownerId: string;
  ownerName: string;
  isOwner: boolean;
  myStatus: RsvpStatus | null;
  goingCount: number;
  maybeCount: number;
  riders: RideEventRider[];
  cancelled: boolean;
  /** Join code of the live map room, while the organiser has it open. */
  liveCode: string | null;
  createdAt: string;
}

export interface RideEventList {
  upcoming: RideEvent[];
  past: RideEvent[];
}
