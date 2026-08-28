import { z } from "zod";

/**
 * Organizations — the business layer shared by the API and the web app.
 *
 * A user can belong to several organizations and still own personal vehicles.
 * Whether a vehicle is personal or organizational is decided by a single field,
 * `bike.orgId`: null means personal (the consumer app, unchanged).
 */

/**
 * Chosen once per organization and effectively permanent — it decides which half
 * of the product the org sees.
 *
 * 'rental'   — they rent vehicles OUT to customers (contracts, handover/return km).
 * 'fleet'    — own-fleet operator; vehicles are assigned to employee drivers.
 * 'personal' — a PERSONAL GARAGE GROUP: a household, a couple, a rider and their
 *              mechanic. Same tables, same permission module, but it is a
 *              consumer feature and NOT the fleet product: no triage board, no
 *              cost rollups, no CSV import, no contracts, no assignments. See
 *              `apps/api/src/lib/orgAccess.ts` for the permission branch and
 *              `apps/api/src/routes/vehicleShares.ts` for the only routes that
 *              can reach one.
 *
 * The split matters commercially as well as technically: fleet organizations are
 * provisioned by the operator and never advertised in-app (docs/fleet-design.md
 * §1, App Review 3.1.1), whereas a personal group is created by the user with a
 * button. Nothing may convert between the two — see `orgSettingsUpdateSchema`,
 * which cannot write this value, and `requireOrgRole`, which refuses to let any
 * fleet route see a personal group at all.
 */
export const orgModeSchema = z.enum(["rental", "fleet", "personal"]);
export type OrgMode = z.infer<typeof orgModeSchema>;

/**
 * The two modes that a BUSINESS organization may hold. Deliberately not
 * `orgModeSchema`: this is the vocabulary of the operator-provisioned fleet
 * product, and 'personal' must be unreachable from it in either direction.
 */
export const orgBusinessModeSchema = z.enum(["rental", "fleet"]);
export type OrgBusinessMode = z.infer<typeof orgBusinessModeSchema>;

/**
 * Membership roles, in descending order of power.
 *
 * owner   — everything, including billing and deleting the organization.
 * manager — everything operational: vehicles, members, contracts, assignments.
 * staff   — day-to-day records (documents, dated items, maintenance, fuel,
 *           trips) on every org vehicle; may NOT delete vehicles, manage members
 *           or touch billing.
 * driver  — ONLY the vehicles currently assigned to them. A driver can never
 *           enumerate the rest of the fleet.
 */
export const orgRoleSchema = z.enum(["owner", "manager", "staff", "driver"]);
export type OrgRole = z.infer<typeof orgRoleSchema>;

/** Highest → lowest. Handy for sorting a member list by seniority. */
export const ORG_ROLES: readonly OrgRole[] = ["owner", "manager", "staff", "driver"] as const;

/**
 * Rank of each role, lower = more powerful. Roles are *almost* a hierarchy, so
 * this is only a convenience for UI ordering and for `roleAtLeast`. It is NOT
 * the permission model: a driver is not "staff minus something", it is scoped to
 * assigned vehicles only. Real decisions go through the API's orgAccess module.
 */
export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  owner: 0,
  manager: 1,
  staff: 2,
  driver: 3,
};

/** True when `role` is at least as powerful as `min` (owner ≥ manager ≥ staff ≥ driver). */
export function roleAtLeast(role: OrgRole, min: OrgRole): boolean {
  return ORG_ROLE_RANK[role] <= ORG_ROLE_RANK[min];
}

export const orgMemberStatusSchema = z.enum(["active", "removed"]);
export type OrgMemberStatus = z.infer<typeof orgMemberStatusSchema>;

export const organizationSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  mode: orgModeSchema,
  /** Active-vehicle ceiling for the org, granted by its fleet subscription. */
  maxVehicles: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Organization = z.infer<typeof organizationSchema>;

export const orgCreateSchema = z.object({
  name: z.string().min(1).max(120),
  mode: orgModeSchema,
});
export type OrgCreateInput = z.infer<typeof orgCreateSchema>;

export const orgUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
});
export type OrgUpdateInput = z.infer<typeof orgUpdateSchema>;

export const orgMemberSchema = z.object({
  orgId: z.string(),
  userId: z.string(),
  role: orgRoleSchema,
  status: orgMemberStatusSchema,
  joinedAt: z.string(),
  /** Denormalised for member lists; the membership row itself has no name. */
  email: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
});
export type OrgMember = z.infer<typeof orgMemberSchema>;

/**
 * One membership as the CALLER sees it — what `GET /api/me`-style responses and
 * the org switcher need: which orgs am I in, as what, and in which mode.
 */
export const orgMembershipSummarySchema = z.object({
  orgId: z.string(),
  name: z.string(),
  mode: orgModeSchema,
  role: orgRoleSchema,
});
export type OrgMembershipSummary = z.infer<typeof orgMembershipSummarySchema>;

export const orgInviteSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  email: z.string().email(),
  role: orgRoleSchema,
  expiresAt: z.string(),
  acceptedAt: z.string().nullable(),
  invitedBy: z.string().nullable(),
  createdAt: z.string(),
});
export type OrgInvite = z.infer<typeof orgInviteSchema>;

/**
 * The invite token is a capability — whoever holds it can join the org — so it
 * is never part of a list response, only of the one-time link handed to the
 * invitee. It is deliberately absent from `orgInviteSchema`.
 */
export const orgInviteCreateSchema = z.object({
  email: z.string().email(),
  role: orgRoleSchema,
});
export type OrgInviteCreateInput = z.infer<typeof orgInviteCreateSchema>;

export const orgInviteAcceptSchema = z.object({
  token: z.string().min(1),
});
export type OrgInviteAcceptInput = z.infer<typeof orgInviteAcceptSchema>;

/** fleet mode: a vehicle in a driver's hands. Open (endedAt === null) = current. */
export const vehicleAssignmentSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  bikeId: z.string(),
  userId: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  startKm: z.number().int().nullable(),
  endKm: z.number().int().nullable(),
  createdAt: z.string(),
});
export type VehicleAssignment = z.infer<typeof vehicleAssignmentSchema>;

export const vehicleAssignmentCreateSchema = z.object({
  bikeId: z.string().min(1),
  userId: z.string().min(1),
  startKm: z.number().int().nonnegative().max(10_000_000).nullable().optional(),
});
export type VehicleAssignmentCreateInput = z.infer<typeof vehicleAssignmentCreateSchema>;

export const vehicleAssignmentEndSchema = z.object({
  endKm: z.number().int().nonnegative().max(10_000_000).nullable().optional(),
});
export type VehicleAssignmentEndInput = z.infer<typeof vehicleAssignmentEndSchema>;

/**
 * rental mode: a renter. NOT an app user — this is third-party personal data the
 * organization is responsible for, so it lives and dies with the organization.
 */
export const fleetCustomerSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string().min(1).max(120),
  phone: z.string().max(40).nullable(),
  email: z.string().max(160).nullable(),
  notes: z.string().max(1000).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FleetCustomer = z.infer<typeof fleetCustomerSchema>;

export const fleetCustomerCreateSchema = fleetCustomerSchema
  .pick({ name: true, phone: true, email: true, notes: true })
  .partial({ phone: true, email: true, notes: true });
export type FleetCustomerCreateInput = z.infer<typeof fleetCustomerCreateSchema>;

export const fleetCustomerUpdateSchema = fleetCustomerCreateSchema.partial();
export type FleetCustomerUpdateInput = z.infer<typeof fleetCustomerUpdateSchema>;

export const rentalContractStatusSchema = z.enum(["open", "returned", "cancelled"]);
export type RentalContractStatus = z.infer<typeof rentalContractStatusSchema>;

export const rentalContractSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  bikeId: z.string(),
  customerId: z.string(),
  startedAt: z.string(),
  /** Agreed end of the rental; `returnedAt` is when it actually came back. */
  endsAt: z.string().nullable(),
  returnedAt: z.string().nullable(),
  handoverKm: z.number().int().nullable(),
  returnKm: z.number().int().nullable(),
  dailyRate: z.number().nullable(),
  currency: z.string().min(3).max(3),
  status: rentalContractStatusSchema,
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RentalContract = z.infer<typeof rentalContractSchema>;

export const rentalContractCreateSchema = z.object({
  bikeId: z.string().min(1),
  customerId: z.string().min(1),
  startedAt: z.string().min(1).optional(),
  endsAt: z.string().min(1).nullable().optional(),
  handoverKm: z.number().int().nonnegative().max(10_000_000).nullable().optional(),
  dailyRate: z.number().nonnegative().max(1_000_000).nullable().optional(),
  currency: z.string().length(3).default("TRY"),
  notes: z.string().max(1000).nullable().optional(),
});
export type RentalContractCreateInput = z.infer<typeof rentalContractCreateSchema>;

/** Closing a contract: the vehicle is back, with the odometer that came with it. */
export const rentalContractReturnSchema = z.object({
  returnKm: z.number().int().nonnegative().max(10_000_000).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});
export type RentalContractReturnInput = z.infer<typeof rentalContractReturnSchema>;
