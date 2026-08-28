import { z } from "zod";
import { orgRoleSchema } from "./organization.js";

/**
 * Vehicle identity, personal garage GROUPS, and ownership HANDOVER.
 *
 * Three features that are really one idea: **a vehicle is a thing in the world,
 * not a row in one person's account.** Once the app can say "this is the same
 * car", it can share it with a spouse, refuse to hold it twice, and move it to
 * whoever owns it now without losing what is known about it.
 *
 * The permission model is NOT new. A personal group is an `organization` in
 * `mode: 'personal'`, so membership, invites, roles and cross-tenant isolation
 * are the machinery the fleet product already uses and that every read path in
 * the API already honours (`apps/api/src/lib/orgAccess.ts`). What is new here is
 * the vocabulary the consumer sees and the identity/handover flow on top.
 */

// ─── identity ────────────────────────────────────────────────────────────────

/**
 * Which field proved that two records are the same vehicle.
 *
 * 'chassis' — the VIN. The only stable identity: it survives a sale, a plate
 *             change and a move between provinces.
 * 'engine'  — strong evidence, NOT proof. Engines get swapped, especially on
 *             older cars and motorcycles, so an engine match opens the "is this
 *             your vehicle?" conversation rather than settling it.
 *
 * Conspicuously absent: **plate**. Turkish plates are re-issued and change when
 * a vehicle moves province, so two different cars legitimately hold the same
 * plate at different times — a plate match is not evidence of identity. It is
 * also the one identifier a stranger can read off a bumper, so answering "that
 * plate is already tracked" would turn the app into a plate-to-user oracle. The
 * registry therefore never stores or matches on a plate.
 */
export const identityKindSchema = z.enum(["chassis", "engine"]);
export type IdentityKind = z.infer<typeof identityKindSchema>;

/**
 * The 409 body from `POST /api/bikes` when the vehicle is already tracked by
 * somebody. Deliberately almost empty: it says THAT the vehicle exists and
 * nothing whatsoever about it or its holder — no nickname, no id, no email, not
 * even whether the holder is one person or a company.
 *
 * `claimToken` is an opaque, single-vehicle, expiring capability. It is the only
 * handle the requester gets, so knowing it reveals nothing and it cannot be used
 * to address any other vehicle.
 */
export const duplicateVehicleSchema = z.object({
  error: z.literal("vehicle_already_registered"),
  matchedOn: identityKindSchema,
  claimToken: z.string(),
});
export type DuplicateVehicle = z.infer<typeof duplicateVehicleSchema>;

// ─── personal groups ─────────────────────────────────────────────────────────

/**
 * What a member may do inside a personal garage group. The DB stores the same
 * four `org_member.role` values the fleet product uses — one column, one CHECK,
 * one permission function — but a household does not talk about "staff" and
 * "drivers", so the consumer vocabulary is mapped here:
 *
 *   owner  ('owner')  — the person who made the group. Everything, including
 *                       removing vehicles and deleting the group.
 *   member ('staff')  — a partner, a parent, an adult child. Everything about
 *                       the group's vehicles EXCEPT deleting one or managing
 *                       people. Sees the full record set, trips and documents
 *                       included: you invited them into your garage.
 *   guest  ('driver') — a mechanic, an inspection agency, a friend borrowing the
 *                       bike. Sees the VEHICLE'S FACTS only: identity, renewal
 *                       dates, service history and odometer. Never your trips,
 *                       never your fuel spending, never your scanned documents.
 *
 * 'manager' exists in the underlying enum but is never offered in a personal
 * group — a household has no middle management, and leaving it unofferable
 * keeps the personal role set to the three a person can actually reason about.
 */
export const shareRoleSchema = z.enum(["owner", "member", "guest"]);
export type ShareRole = z.infer<typeof shareRoleSchema>;

/** The role a share INVITE may hand out. Never `owner`: a group has exactly one
 *  founder, and "give my whole garage away" is the handover flow, not an invite. */
export const shareInviteRoleSchema = z.enum(["member", "guest"]);
export type ShareInviteRole = z.infer<typeof shareInviteRoleSchema>;

const SHARE_TO_ORG: Record<ShareRole, z.infer<typeof orgRoleSchema>> = {
  owner: "owner",
  member: "staff",
  guest: "driver",
};

/** Consumer vocabulary → the stored `org_member.role`. */
export function orgRoleForShareRole(role: ShareRole): z.infer<typeof orgRoleSchema> {
  return SHARE_TO_ORG[role];
}

/**
 * Stored `org_member.role` → consumer vocabulary. `manager` maps to `member`
 * because it is unreachable in a personal group; if one ever appeared (an org
 * mis-provisioned by hand) it must still render as something a person can read.
 */
export function shareRoleForOrgRole(role: z.infer<typeof orgRoleSchema>): ShareRole {
  if (role === "owner") return "owner";
  if (role === "driver") return "guest";
  return "member";
}

/**
 * A GROUP: a named collection of vehicles — "Ducatis", "Arabalarım", "Aile
 * Garajı" — that may also be shared with people.
 *
 * ONE VEHICLE MAY BE IN SEVERAL GROUPS. That is the shape of the thing, not an
 * incidental detail: the four examples the feature was asked for ("my cars", "my
 * bikes", "Ducatis", "BMWs") are two overlapping axes, and a Ducati Monster
 * belongs in "my bikes" and in "Ducatis" at once. Membership therefore lives in
 * a join table (`bike_group`, migration 029) rather than in a column on the
 * vehicle.
 *
 * Organising and sharing are ONE concept rather than two, under a single rule:
 * **a group's members see the group's vehicles.** A group nobody else is in is a
 * folder; invite somebody and the same folder is a shared garage. Nothing has to
 * be migrated to go from one to the other, and visibility is the union over a
 * vehicle's groups — monotonic, so filing a car in one more group can only ever
 * widen who sees it.
 */
export const shareGroupSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  /** The CALLER's role in it. The client mirrors permissions from this. */
  role: shareRoleSchema,
  vehicleCount: z.number().int().nonnegative(),
  /**
   * Active members, INCLUDING the caller — so 1 means "nobody else", which is
   * how the UI tells a private collection from a shared garage. It is the
   * difference between a folder and a disclosure, so it is never inferred from
   * the vehicle count or from whether an invite happens to be pending.
   */
  memberCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type ShareGroup = z.infer<typeof shareGroupSchema>;

export const shareGroupCreateSchema = z.object({
  name: z.string().min(1).max(80),
});
export type ShareGroupCreateInput = z.infer<typeof shareGroupCreateSchema>;

export const shareGroupUpdateSchema = z.object({
  name: z.string().min(1).max(80),
});
export type ShareGroupUpdateInput = z.infer<typeof shareGroupUpdateSchema>;

export const shareMemberSchema = z.object({
  userId: z.string(),
  role: shareRoleSchema,
  email: z.string().nullable(),
  name: z.string().nullable(),
  joinedAt: z.string(),
  isSelf: z.boolean(),
});
export type ShareMember = z.infer<typeof shareMemberSchema>;

export const shareInviteCreateSchema = z.object({
  email: z.string().email(),
  role: shareInviteRoleSchema,
});
export type ShareInviteCreateInput = z.infer<typeof shareInviteCreateSchema>;

/**
 * A single-vehicle share. It creates a personal group holding exactly that
 * vehicle and invites one person into it, because "share this car with my
 * mechanic" and "share my garage with my wife" are the same relationship at two
 * sizes — and modelling them as one thing means there is ONE permission model to
 * get right rather than two. A one-vehicle group can grow later without a
 * migration; two parallel systems could not have been merged at all.
 */
export const vehicleShareCreateSchema = z.object({
  email: z.string().email(),
  role: shareInviteRoleSchema,
  /** Optional name for the group this creates; defaults to the vehicle's. */
  groupName: z.string().min(1).max(80).optional(),
  /**
   * WHICH group to invite into. Needed since a vehicle may be in several: the
   * server can only infer the target when the vehicle is in exactly one group
   * the caller owns, and it refuses to guess among more (it makes a fresh
   * one-vehicle group instead). Screens that already know which group the user
   * is looking at send it; the one-tap share on a vehicle screen does not.
   */
  groupId: z.string().min(1).optional(),
});
export type VehicleShareCreateInput = z.infer<typeof vehicleShareCreateSchema>;

/**
 * Set the COMPLETE list of groups one vehicle belongs to.
 *
 * A whole-set PUT rather than add/remove calls, because that is the gesture the
 * interface makes — a user ticks and unticks a list and taps done. A client-side
 * diff of several requests can half-apply; one idempotent write cannot, and a
 * retry after a dropped connection is free.
 *
 * Capped at MAX_SHARE_GROUPS: a vehicle cannot be in more groups than a person
 * is allowed to have.
 */
export const vehicleGroupsSetSchema = z.object({
  groupIds: z.array(z.string().min(1)).max(10),
});
export type VehicleGroupsSetInput = z.infer<typeof vehicleGroupsSetSchema>;

/** The invite token is a bearer capability, so it is returned exactly once. */
export const shareInviteSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  email: z.string(),
  role: shareRoleSchema,
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type ShareInvite = z.infer<typeof shareInviteSchema>;

/** What someone holding an invite link is told BEFORE they accept. */
export const shareInvitePreviewSchema = z.object({
  groupName: z.string(),
  role: shareRoleSchema,
  vehicleCount: z.number().int().nonnegative(),
  expiresAt: z.string(),
  /** Already a member — accepting again is a no-op. */
  alreadyMember: z.boolean(),
});
export type ShareInvitePreview = z.infer<typeof shareInvitePreviewSchema>;

export const shareAcceptSchema = z.object({ token: z.string().min(1) });
export type ShareAcceptInput = z.infer<typeof shareAcceptSchema>;

export const shareGroupAddVehicleSchema = z.object({ bikeId: z.string().min(1) });
export type ShareGroupAddVehicleInput = z.infer<typeof shareGroupAddVehicleSchema>;

// ─── claims & handover ───────────────────────────────────────────────────────

/**
 * Why the requester is knocking.
 *
 * 'access'   — "that is my family's car, let me in." Approving creates a share.
 * 'purchase' — "I bought this vehicle." Approving performs a HANDOVER: the
 *              vehicle and its factual history move to the buyer, and the
 *              seller's trips, fuel logs and documents stay with the seller.
 */
export const claimKindSchema = z.enum(["access", "purchase"]);
export type ClaimKind = z.infer<typeof claimKindSchema>;

export const claimStatusSchema = z.enum([
  "pending",
  "approved",
  "declined",
  "withdrawn",
  "expired",
]);
export type ClaimStatus = z.infer<typeof claimStatusSchema>;

export const claimCreateSchema = z.object({
  claimToken: z.string().min(1),
  kind: claimKindSchema,
  /** Free text shown to the holder. Capped, and never rendered as HTML. */
  message: z.string().max(280).optional(),
});
export type ClaimCreateInput = z.infer<typeof claimCreateSchema>;

/**
 * A claim as the REQUESTER sees it. Note what is missing: anything at all about
 * the vehicle or its holder. The requester learns only what they already knew —
 * the identifier they typed — plus whether their request was answered.
 */
export const outgoingClaimSchema = z.object({
  id: z.string(),
  kind: claimKindSchema,
  status: claimStatusSchema,
  /** The identifier the requester supplied, echoed back so they can tell two
   *  claims apart. Never a value they did not already have. */
  identifierHint: z.string(),
  matchedOn: identityKindSchema,
  createdAt: z.string(),
  expiresAt: z.string(),
  decidedAt: z.string().nullable(),
  /** True once the claim has gone unanswered long enough that the requester may
   *  start a separate record of their own. */
  separateRecordAvailable: z.boolean(),
  /** Set once they have. */
  separateRecordBikeId: z.string().nullable(),
});
export type OutgoingClaim = z.infer<typeof outgoingClaimSchema>;

/**
 * A claim as the HOLDER sees it. This one does name the requester — the holder
 * cannot sensibly decide "shall I share my car with this person" against an
 * anonymous handle, and the requester chose to knock. It is disclosed in the
 * privacy policy.
 */
export const incomingClaimSchema = z.object({
  id: z.string(),
  bikeId: z.string(),
  bikeNickname: z.string(),
  kind: claimKindSchema,
  matchedOn: identityKindSchema,
  requesterName: z.string().nullable(),
  requesterEmail: z.string(),
  message: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type IncomingClaim = z.infer<typeof incomingClaimSchema>;

export const claimApproveSchema = z.object({
  /** For an 'access' claim only: what to grant. Ignored for 'purchase'. */
  role: shareInviteRoleSchema.default("guest"),
});
export type ClaimApproveInput = z.infer<typeof claimApproveSchema>;

/** How long a holder has to answer before the requester gets the fallback. */
export const CLAIM_RESPONSE_DAYS = 21;

/** Ceiling on personal groups per user — a household, not a directory. */
export const MAX_SHARE_GROUPS = 10;

/** Ceiling on members in one personal group. */
export const MAX_SHARE_MEMBERS = 8;

/**
 * What a HANDOVER moves, stated once so the API, the UI and the privacy policy
 * cannot drift apart. This is the product decision, not an implementation
 * detail: the vehicle's history is about the car, but trips, documents and
 * spending are about the person.
 *
 * A scanned ruhsat carries the previous owner's TC kimlik number, name and home
 * address; a trip log is everywhere they drove; a fuel log is what they spent.
 * Handing any of that to the stranger who bought the car is a KVKK disclosure
 * with no lawful basis, so it does not travel — no setting, no override.
 */
export const HANDOVER_TRANSFERS = [
  "identity", // make, model, year, chassis, engine
  "renewals", // muayene / sigorta / kasko / MTV
  "maintenance", // service records
  "odometer",
] as const;

export const HANDOVER_KEEPS = [
  "trips",
  "fuelLogs",
  "documents",
  "photos",
] as const;
