import { useMemo } from "react";
import type { EntitlementSummary, OrgRole } from "@mototracker/shared";
import { canManageFleet, useOrgs, type OrgMembership } from "@/hooks/useOrgs";

/**
 * WHICH GARAGE a new vehicle goes into, and WHICH CEILING refuses it.
 *
 * Both rules are pure functions so they can be tested without a DOM, and both
 * live here — under `pages/fleet/` rather than in `hooks/` — for a bundle
 * reason that is really a product reason: `hooks/useOrgs.ts` is reached from
 * AppShell and therefore sits in the entry chunk every consumer downloads on
 * first paint. Fleet is invisible to consumers (docs/fleet-design.md §1), and
 * that has to include the bytes. The three call sites (the fleet inventory's
 * "add vehicle", `AddVehicleButton`, `BikeFormPage`) are all lazy chunks.
 */

/**
 * The garage a NEW vehicle is being created in.
 *
 * `personal` is the consumer app and the default; `org` is a company vehicle
 * billed to `organization.max_vehicles`. `denied` covers a member without the
 * standing to size the fleet (staff, driver) and a non-member who typed the URL
 * — the server refuses both (403 / 404); this only keeps the UI honest.
 */
export type VehicleTarget =
  | { kind: "personal" }
  | { kind: "pending" }
  | { kind: "org"; org: OrgMembership }
  | { kind: "denied"; role: OrgRole | null };

/**
 * Adding a vehicle grows the org's bill, which makes it an owner/manager act —
 * staff run the fleet, they don't size it. That is exactly what
 * `POST /api/bikes` enforces (apps/api/src/routes/bikes.ts), mirroring the
 * "delete" boundary in apps/api/src/lib/orgAccess.ts. Mirrored here once and
 * nowhere else.
 */
export function resolveVehicleTarget(
  orgId: string | null | undefined,
  orgs: OrgMembership[] | undefined,
): VehicleTarget {
  if (!orgId) return { kind: "personal" };
  if (!orgs) return { kind: "pending" };
  const org = orgs.find((o) => o.orgId === orgId);
  if (!org) return { kind: "denied", role: null };
  return canManageFleet(org.role) ? { kind: "org", org } : { kind: "denied", role: org.role };
}

/**
 * Resolve the target garage for `/bikes/new`, from the `?orgId=` the fleet
 * inventory links with. With no id in the URL this fetches nothing and answers
 * `personal` immediately — the consumer form is untouched.
 */
export function useVehicleTarget(orgId: string | null | undefined): VehicleTarget {
  const orgs = useOrgs({ enabled: !!orgId });
  return useMemo(() => resolveVehicleTarget(orgId, orgs.data), [orgId, orgs.data]);
}

/** Where to send someone who may not add a vehicle to the org they asked for. */
export function deniedRedirect(role: OrgRole | null): string {
  // Staff can see the fleet, so return them to it. A driver or a stranger gets
  // the ordinary garage — they must not land on anything fleet-shaped (§3).
  return role === "staff" ? "/fleet/vehicles" : "/bikes";
}

/** Where a tap on "add a vehicle" leads. */
export type AddVehicleIntent = { kind: "navigate"; to: string } | { kind: "paywall" };

/**
 * The one decision behind every "add a vehicle" affordance.
 *
 * Two garages, two ceilings:
 *
 *   • PERSONAL — the consumer entitlement. At the cap, the IAP paywall is the
 *     correct and only answer.
 *   • ORGANIZATION — `organization.max_vehicles`, sold offline. The consumer
 *     paywall must NEVER appear here: fleet carries no in-app acquisition
 *     affordance at all (docs/fleet-design.md §1, App Store Guideline 3.1.1),
 *     and a member's personal subscription buys no fleet slots anyway
 *     (apps/api/src/lib/entitlement.ts). So an org intent never consults the
 *     entitlement, not even when it is loaded and exhausted.
 *
 * The org path goes to the manual form rather than `/capture`: the scanner
 * creates its vehicle from the review screen, which carries no org context, and
 * a manager registering a van is copying a ruhsat they already have in hand.
 */
export function addVehicleIntent(
  orgId: string | undefined,
  entitlement: EntitlementSummary | undefined,
): AddVehicleIntent {
  if (orgId) return { kind: "navigate", to: `/bikes/new?orgId=${encodeURIComponent(orgId)}` };
  // While entitlement is still loading we optimistically proceed; the create
  // call 403s as a backstop if the user is actually over the limit.
  if (entitlement && !entitlement.canAddVehicle) return { kind: "paywall" };
  return { kind: "navigate", to: "/capture" };
}
