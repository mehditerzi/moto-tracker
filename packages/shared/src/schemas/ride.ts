import { z } from "zod";

/**
 * The group-ride wire protocol.
 *
 * Two things travel over the ride WebSocket besides positions: the leader's
 * **planned route** (so followers see the same line and the same next
 * checkpoint, not just each other's dots) and a **rally point** (the leader
 * saying "regroup here"). Both are relayed exactly like positions are — held in
 * the room in memory for the life of the ride and never written to disk — so
 * the privacy property stated in the privacy policy is unchanged.
 *
 * The schemas live in `shared` because the server is the only thing that can
 * enforce the size limits the 16 KiB frame cap depends on, and the client is
 * the only thing that can stay under them. Both sides must agree exactly.
 */

/**
 * What a stop is *for*. A group rallies at named things — fuel, food, a
 * viewpoint, a regroup — and a rider glancing at a list at 90 km/h reads the
 * icon long before they read the name.
 */
export const CHECKPOINT_KINDS = ["stop", "fuel", "food", "view", "regroup"] as const;
export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];

/**
 * Waypoint ceiling. MapKit JS Directions has no multi-waypoint request, so a
 * plan costs one routing call per leg — 12 stops is already 12 calls, and a day
 * ride with more legs than that wants a different tool.
 */
export const MAX_STOPS = 12;

/**
 * Encoded-polyline budget for a shared route. The hub caps a frame at 16 KiB;
 * 8000 chars of polyline plus 12 stops plus JSON overhead stays comfortably
 * under it, and the client simplifies the line to fit before sending.
 */
export const MAX_SHARED_ROUTE_CHARS = 8000;

const latSchema = z.number().min(-90).max(90);
const lngSchema = z.number().min(-180).max(180);

export const ridePlaceSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  lat: latSchema,
  lng: lngSchema,
  kind: z.enum(CHECKPOINT_KINDS),
});
export type RidePlace = z.infer<typeof ridePlaceSchema>;

export const rideRouteSchema = z.object({
  /** Encoded polyline (Google algorithm, 1e-5) of the whole planned line. */
  line: z.string().max(MAX_SHARED_ROUTE_CHARS),
  stops: z.array(ridePlaceSchema).max(MAX_STOPS),
  distanceKm: z.number().nonnegative().max(100_000),
  durationMin: z.number().nonnegative().max(100_000),
});
export type RideRoute = z.infer<typeof rideRouteSchema>;

export const rideRallySchema = z.object({
  lat: latSchema,
  lng: lngSchema,
  name: z.string().max(80).optional(),
});
export type RideRally = z.infer<typeof rideRallySchema>;

/**
 * Client → server. `t` discriminates; a frame with no `t` at all is the legacy
 * bare position `{lat,lng,speed}` that shipped first and may still be in a
 * cached bundle on someone's phone, so the hub keeps accepting it.
 */
export const rideClientFrameSchema = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("pos"),
    lat: latSchema,
    lng: lngSchema,
    speed: z.number().nullable().optional(),
  }),
  /** Leader only. `null` retracts a previously shared route. */
  z.object({ t: z.literal("route"), route: rideRouteSchema.nullable() }),
  /** Leader only. `null` clears the rally point. */
  z.object({ t: z.literal("rally"), rally: rideRallySchema.nullable() }),
]);
export type RideClientFrame = z.infer<typeof rideClientFrameSchema>;

export const ridePositionSchema = z.object({
  lat: latSchema,
  lng: lngSchema,
  speed: z.number().nullable(),
  /** Server receive time, epoch ms. Freshness is judged on our clock, not theirs. */
  t: z.number(),
});
export type RidePosition = z.infer<typeof ridePositionSchema>;

/** One row of the roster the hub fans out. */
export interface RideRosterMember {
  userId: string;
  name: string;
  isOwner: boolean;
  pos: RidePosition | null;
}

/**
 * Server → client. `roster` is throttled to ≤1/s; `state` is sent immediately
 * on change and once to every socket as it joins (so a late joiner sees the
 * route without waiting for the leader to re-share).
 */
export type RideServerFrame =
  | { type: "roster"; members: RideRosterMember[] }
  | { type: "state"; route: RideRoute | null; rally: (RideRally & { at: number }) | null }
  | { type: "ended" };
