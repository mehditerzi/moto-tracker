import { describe, it, expect } from "vitest";
import {
  addVehicleIntent,
  deniedRedirect,
  resolveVehicleTarget,
} from "@/pages/fleet/vehicleTarget";
import type { OrgMembership } from "@/hooks/useOrgs";
import type { EntitlementSummary } from "@mototracker/shared";

/**
 * The two rules behind "add a vehicle", isolated from React so they can be
 * asserted directly:
 *
 *   1. WHICH GARAGE — only an owner/manager may add to an organization, and
 *      only when the URL actually names one. Mirrors POST /api/bikes.
 *   2. WHICH CEILING — a personal vehicle is the consumer entitlement and may
 *      open the IAP paywall; an ORG vehicle is `organization.max_vehicles` and
 *      must never reach the paywall, because fleet is sold offline and the app
 *      carries no fleet acquisition affordance (docs/fleet-design.md §1).
 */

const org = (role: OrgMembership["role"]): OrgMembership => ({
  orgId: "org_1",
  name: "Kervan Filo",
  mode: "fleet",
  role,
});

const entitlement = (canAdd: boolean): EntitlementSummary => ({
  tier: "free",
  productId: null,
  status: "free",
  maxVehicles: 1,
  activeVehicles: canAdd ? 0 : 1,
  canAddVehicle: canAdd,
  expiresAt: null,
});

describe("resolveVehicleTarget", () => {
  it("is personal when the URL names no organization — the consumer path", () => {
    expect(resolveVehicleTarget(null, undefined)).toEqual({ kind: "personal" });
    expect(resolveVehicleTarget("", [org("owner")])).toEqual({ kind: "personal" });
    // And it never depends on the membership list, so the consumer form has no
    // reason to fetch one.
    expect(resolveVehicleTarget(undefined, [org("owner")])).toEqual({ kind: "personal" });
  });

  it("waits rather than guessing while membership is still loading", () => {
    expect(resolveVehicleTarget("org_1", undefined)).toEqual({ kind: "pending" });
  });

  it("targets the organization for an owner and for a manager", () => {
    for (const role of ["owner", "manager"] as const) {
      const target = resolveVehicleTarget("org_1", [org(role)]);
      expect(target.kind).toBe("org");
      expect(target.kind === "org" && target.org.orgId).toBe("org_1");
    }
  });

  it("refuses staff and drivers — fleet size is a billing decision", () => {
    expect(resolveVehicleTarget("org_1", [org("staff")])).toEqual({ kind: "denied", role: "staff" });
    expect(resolveVehicleTarget("org_1", [org("driver")])).toEqual({
      kind: "denied",
      role: "driver",
    });
  });

  it("refuses an org the user does not belong to", () => {
    expect(resolveVehicleTarget("someone_elses_org", [org("owner")])).toEqual({
      kind: "denied",
      role: null,
    });
  });

  it("sends the refused somewhere ordinary — never a locked door", () => {
    // Staff can see the fleet, so they go back to it.
    expect(deniedRedirect("staff")).toBe("/fleet/vehicles");
    // A driver or a stranger must not land on anything fleet-shaped (§3).
    expect(deniedRedirect("driver")).toBe("/bikes");
    expect(deniedRedirect(null)).toBe("/bikes");
  });
});

describe("addVehicleIntent", () => {
  it("is unchanged for a consumer: capture below the cap, paywall at it", () => {
    expect(addVehicleIntent(undefined, entitlement(true))).toEqual({
      kind: "navigate",
      to: "/capture",
    });
    expect(addVehicleIntent(undefined, entitlement(false))).toEqual({ kind: "paywall" });
    // Still loading — proceed; the API 403s as the backstop.
    expect(addVehicleIntent(undefined, undefined)).toEqual({ kind: "navigate", to: "/capture" });
  });

  it("never opens the consumer paywall in an org context", () => {
    // Even with the personal allowance fully spent — an org vehicle is billed
    // to the organization, and there is nothing to sell here (§1 / 3.1.1).
    for (const ent of [entitlement(false), entitlement(true), undefined]) {
      expect(addVehicleIntent("org_1", ent)).toEqual({
        kind: "navigate",
        to: "/bikes/new?orgId=org_1",
      });
    }
  });

  it("carries the org id through the URL so a reload cannot lose the garage", () => {
    const intent = addVehicleIntent("org/with spaces&", entitlement(true));
    expect(intent).toEqual({ kind: "navigate", to: "/bikes/new?orgId=org%2Fwith%20spaces%26" });
    const url = new URL(`https://x.test${intent.kind === "navigate" ? intent.to : ""}`);
    expect(url.searchParams.get("orgId")).toBe("org/with spaces&");
  });
});
