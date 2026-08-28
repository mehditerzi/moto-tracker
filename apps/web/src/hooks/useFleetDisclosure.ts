import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Bike } from "@mototracker/shared";
import { api } from "@/lib/api";
import { useMe } from "@/hooks/useMe";
import { useOrgs, type OrgMembership } from "@/hooks/useOrgs";

/**
 * The employee-monitoring disclosure, driver side.
 *
 * On a company vehicle the organization's owner, managers and staff can read the
 * GPS routes its driver recorded. That is monitoring of an employee, so under
 * KVKK it has to be *disclosed to the person being monitored*, in Turkish,
 * before it starts — not buried in a policy nobody opens. Drivers see no fleet
 * chrome at all (docs/fleet-design.md §3), so the disclosure has to live in the
 * consumer surfaces a driver actually uses: this hook drives the persistent
 * "company vehicle" marker and the one-time acknowledgement.
 *
 * COST TO A CONSUMER: one `GET /api/orgs` (an indexed lookup that returns `[]`).
 * The vehicle list is only fetched when that came back non-empty, so a user with
 * no membership makes no extra request and, more importantly, is never told that
 * any of this exists.
 */

const ACK_PREFIX = "mototracker.orgTripAck";
const listeners = new Set<() => void>();
/** Bumped on every acknowledgement so `useSyncExternalStore` sees a new value —
 *  the acknowledgement itself lives in localStorage, which React cannot watch. */
let ackTick = 0;

function ackKey(userId: string, orgId: string): string {
  return `${ACK_PREFIX}.${userId}.${orgId}`;
}

export function hasAcknowledgedOrg(userId: string, orgId: string): boolean {
  try {
    return localStorage.getItem(ackKey(userId, orgId)) === "1";
  } catch {
    // Storage disabled: treat as acknowledged rather than trapping the user
    // behind a dialog they can never dismiss. The marker on the vehicle and the
    // privacy policy still carry the disclosure.
    return true;
  }
}

export function acknowledgeOrg(userId: string, orgId: string): void {
  try {
    localStorage.setItem(ackKey(userId, orgId), "1");
  } catch {
    /* ignore */
  }
  ackTick += 1;
  listeners.forEach((l) => l());
}

/** Bumps whenever an acknowledgement lands, so the gate below re-reads storage. */
function useAckVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => ackTick,
    () => 0,
  );
}

export interface OrgVehicleInfo {
  orgId: string;
  orgName: string;
}

export interface FleetDisclosure {
  /** bikeId → the organization that owns it. Empty for every consumer. */
  orgVehicles: Map<string, OrgVehicleInfo>;
  /**
   * The org whose disclosure this user has not acknowledged yet, if any. While
   * this is non-null the app suspends trip recording — that is what makes the
   * acknowledgement happen BEFORE the first trip on a company vehicle rather
   * than after it.
   */
  pending: OrgMembership | null;
  /** Call once the driver has read and accepted the notice. */
  acknowledge: (orgId: string) => void;
}

export function useFleetDisclosure(): FleetDisclosure {
  const me = useMe();
  const orgs = useOrgs();
  const version = useAckVersion();
  const hasOrgs = (orgs.data?.length ?? 0) > 0;

  // Same query key as useBikes(), so this shares one cache entry with the
  // garage screens rather than duplicating the request.
  const bikes = useQuery<Bike[]>({
    queryKey: ["bikes"],
    queryFn: () => api<Bike[]>("/api/bikes"),
    enabled: hasOrgs,
    staleTime: 60_000,
  });

  // BUSINESS orgs only. This hook drives the "company vehicle" badge and the
  // employee-monitoring notice that suspends trip recording until it is
  // acknowledged — a disclosure about an EMPLOYER. A personal garage group is an
  // `organization` too, so without this filter sharing a car with your spouse
  // would flag it as a company vehicle and tell you your employer can see where
  // you drive, which is both false and alarming.
  const memberships = (orgs.data ?? []).filter((o) => o.mode !== "personal");
  const byId = new Map(memberships.map((o) => [o.orgId, o]));
  const orgVehicles = new Map<string, OrgVehicleInfo>();
  for (const b of bikes.data ?? []) {
    if (!b.orgId) continue;
    const org = byId.get(b.orgId);
    if (!org) continue;
    orgVehicles.set(b.id, { orgId: org.orgId, orgName: org.name });
  }

  const userId = me.data?.user.id;
  let pending: OrgMembership | null = null;
  if (userId) {
    // Only an org the user can actually end up driving for — no vehicle, no
    // monitoring, no notice.
    const orgIdsWithVehicles = new Set([...orgVehicles.values()].map((v) => v.orgId));
    for (const org of memberships) {
      if (!orgIdsWithVehicles.has(org.orgId)) continue;
      if (!hasAcknowledgedOrg(userId, org.orgId)) {
        pending = org;
        break;
      }
    }
  }
  void version; // re-render dependency: storage is read imperatively above

  return {
    orgVehicles,
    pending,
    acknowledge: (orgId: string) => {
      if (userId) acknowledgeOrg(userId, orgId);
    },
  };
}
