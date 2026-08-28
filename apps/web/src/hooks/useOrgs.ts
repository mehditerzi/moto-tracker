import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { OrgMode, OrgRole } from "@mototracker/shared";

/**
 * Organization membership — the ONE thing every fleet decision in the client
 * hangs off.
 *
 * `GET /api/orgs` is deliberately cheap (one indexed lookup, see
 * apps/api/src/routes/orgs.ts) because it runs for every signed-in user,
 * including the overwhelming majority who are consumers and get `[]` back.
 *
 * Two rules from docs/fleet-design.md §1 and §3 are enforced here rather than
 * being re-derived at each call site, because getting either of them wrong is an
 * App Store problem and not merely a bug:
 *
 *   1. A user with NO membership must never see fleet chrome, copy or
 *      navigation. The gate is this response, not a feature flag.
 *   2. A DRIVER has a membership but gets no fleet UI either — their experience
 *      is the consumer dashboard scoped to the vehicle in their hands. The API
 *      includes them here on purpose so the client *can* gate; `fleetOrgs`
 *      below is what every piece of fleet chrome reads.
 */

export interface OrgMembership {
  orgId: string;
  name: string;
  mode: OrgMode;
  role: OrgRole;
}

export const ORGS_KEY = ["orgs"] as const;

export function useOrgs({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<OrgMembership[]>({
    queryKey: ORGS_KEY,
    queryFn: () => api<OrgMembership[]>("/api/orgs"),
    // Membership changes about as often as a contract is signed. Caching it hard
    // keeps this off the critical path of every navigation.
    staleTime: 5 * 60_000,
    // `enabled: false` is how the consumer vehicle form stays exactly what it
    // was: with no org in play it asks nothing about organizations at all.
    enabled,
  });
}

const ACTIVE_ORG_KEY = "mototracker.activeOrgId";

function storedOrgId(): string | undefined {
  try {
    return localStorage.getItem(ACTIVE_ORG_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function storeOrgId(id: string | undefined): void {
  try {
    if (id) localStorage.setItem(ACTIVE_ORG_KEY, id);
    else localStorage.removeItem(ACTIVE_ORG_KEY);
  } catch {
    /* private mode / disabled storage — selection stays ephemeral */
  }
}

export interface FleetAccess {
  /** Still deciding. Render NOTHING fleet-shaped while this is true. */
  isPending: boolean;
  /** Every membership, drivers included. */
  orgs: OrgMembership[];
  /** Memberships that may see fleet UI at all — never a driver. */
  fleetOrgs: OrgMembership[];
  /** True when fleet nav/chrome may be rendered for this user. */
  canSeeFleet: boolean;
  /** The org the fleet screens are currently pointed at. */
  active: OrgMembership | null;
  setActiveOrgId: (id: string) => void;
}

/**
 * The single gate. Everything that could reveal fleet's existence — the nav
 * entry, the /fleet routes, the board — asks this and nothing else.
 *
 * A user in exactly one org (the normal case) never sees an org switcher; the
 * stored id only matters for the rare member of two fleets.
 */
export function useFleetAccess(): FleetAccess {
  const orgs = useOrgs();
  const [selected, setSelected] = useState<string | undefined>(storedOrgId);

  const setActiveOrgId = useCallback((id: string) => {
    setSelected(id);
    storeOrgId(id);
  }, []);

  return useMemo(() => {
    const all = orgs.data ?? [];
    const fleetOrgs = all.filter((o) => o.role !== "driver");
    // Self-heal a stored id that points at an org the user has left, so a stale
    // localStorage value can never strand a manager on an empty board.
    const active = fleetOrgs.find((o) => o.orgId === selected) ?? fleetOrgs[0] ?? null;
    return {
      isPending: orgs.isPending,
      orgs: all,
      fleetOrgs,
      canSeeFleet: fleetOrgs.length > 0,
      active,
      setActiveOrgId,
    };
  }, [orgs.data, orgs.isPending, selected, setActiveOrgId]);
}

/** Role helpers, mirroring apps/api/src/lib/orgAccess.ts. Never the enforcement
 *  point — the server decides — but they keep the UI from offering actions that
 *  are guaranteed to 403. */
export function canManageFleet(role: OrgRole | undefined): boolean {
  return role === "owner" || role === "manager";
}
export function isOwner(role: OrgRole | undefined): boolean {
  return role === "owner";
}
