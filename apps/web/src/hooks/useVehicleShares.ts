import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { ENTITLEMENT_KEY } from "@/hooks/useEntitlement";
import { ORGS_KEY } from "@/hooks/useOrgs";
import type {
  DuplicateVehicle,
  IncomingClaim,
  OutgoingClaim,
  ShareGroup,
  ShareInvitePreview,
  ShareInviteRole,
  ShareMember,
} from "@mototracker/shared";

/**
 * Garage groups, invitations and ownership claims.
 *
 * Every mutation here can change WHICH VEHICLES EXIST for the caller, so almost
 * all of them invalidate `["bikes"]`, `["dashboard"]` and the entitlement — a
 * stale garage list after accepting an invitation is the difference between "it
 * worked" and "nothing happened".
 *
 * `ORGS_KEY` is invalidated too, because a personal group IS an organization
 * (see the API's routes/vehicleShares.ts): `useFleetAccess` and the disclosure
 * hook both read that cache and both filter on `mode`, so they must see a new
 * group appear or a deleted one vanish.
 */

export const SHARE_GROUPS_KEY = ["vehicle-shares", "groups"] as const;
export const INCOMING_CLAIMS_KEY = ["vehicle-shares", "claims", "incoming"] as const;
export const OUTGOING_CLAIMS_KEY = ["vehicle-shares", "claims", "outgoing"] as const;

/** Everything a sharing change can invalidate, in one place so none is forgotten. */
function invalidateGarage(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["bikes"] });
  qc.invalidateQueries({ queryKey: ["dashboard"] });
  qc.invalidateQueries({ queryKey: ENTITLEMENT_KEY });
  qc.invalidateQueries({ queryKey: SHARE_GROUPS_KEY });
  qc.invalidateQueries({ queryKey: ORGS_KEY });
}

export function useShareGroups({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<ShareGroup[]>({
    queryKey: SHARE_GROUPS_KEY,
    queryFn: () => api<ShareGroup[]>("/api/vehicle-shares/groups"),
    staleTime: 60_000,
    enabled,
  });
}

export function useGroupMembers(groupId: string | undefined) {
  return useQuery<ShareMember[]>({
    queryKey: ["vehicle-shares", "members", groupId],
    queryFn: () => api<ShareMember[]>(`/api/vehicle-shares/groups/${groupId}/members`),
    enabled: !!groupId,
  });
}

export function useCreateShareGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api<ShareGroup>("/api/vehicle-shares/groups", { method: "POST", json: { name } }),
    onSuccess: () => invalidateGarage(qc),
  });
}

export function useRenameShareGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, name }: { groupId: string; name: string }) =>
      api<ShareGroup>(`/api/vehicle-shares/groups/${groupId}`, { method: "PATCH", json: { name } }),
    onSuccess: () => invalidateGarage(qc),
  });
}

export function useDeleteShareGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) =>
      api<void>(`/api/vehicle-shares/groups/${groupId}`, { method: "DELETE" }),
    onSuccess: () => invalidateGarage(qc),
  });
}

export function useLeaveShareGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, userId }: { groupId: string; userId: string }) =>
      api<void>(`/api/vehicle-shares/groups/${groupId}/members/${userId}`, { method: "DELETE" }),
    onSuccess: (_r, v) => {
      invalidateGarage(qc);
      qc.invalidateQueries({ queryKey: ["vehicle-shares", "members", v.groupId] });
    },
  });
}

export function useAddVehicleToGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, bikeId }: { groupId: string; bikeId: string }) =>
      api<void>(`/api/vehicle-shares/groups/${groupId}/vehicles`, {
        method: "POST",
        json: { bikeId },
      }),
    onSuccess: () => invalidateGarage(qc),
  });
}

export function useRemoveVehicleFromGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, bikeId }: { groupId: string; bikeId: string }) =>
      api<void>(`/api/vehicle-shares/groups/${groupId}/vehicles/${bikeId}`, { method: "DELETE" }),
    onSuccess: () => invalidateGarage(qc),
  });
}

/**
 * Set the COMPLETE list of groups one vehicle is filed in.
 *
 * One idempotent write rather than a client-side diff of adds and removes: the
 * gesture is "tick these, untick those, done", and a diff that half-applies
 * leaves the user looking at a garage that disagrees with itself.
 */
export function useSetVehicleGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bikeId, groupIds }: { bikeId: string; groupIds: string[] }) =>
      api<{ groupIds: string[] }>(`/api/vehicle-shares/vehicles/${bikeId}/groups`, {
        method: "PUT",
        json: { groupIds },
      }),
    onSuccess: (_r, v) => {
      invalidateGarage(qc);
      qc.invalidateQueries({ queryKey: ["bikes", v.bikeId] });
    },
  });
}

/**
 * The invitation token comes back exactly once, in the response to creating it,
 * and is never in a list — so the caller must show or copy it immediately. Both
 * mutations below return it for that reason.
 */
export interface ShareInviteResult {
  groupId: string;
  token: string;
  email: string;
  role: ShareInviteRole;
  expiresAt: string;
}

export function useInviteToGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      groupId,
      email,
      role,
    }: {
      groupId: string;
      email: string;
      role: ShareInviteRole;
    }) =>
      api<ShareInviteResult>(`/api/vehicle-shares/groups/${groupId}/invites`, {
        method: "POST",
        json: { email, role },
      }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["vehicle-shares", "members", v.groupId] });
    },
  });
}

/**
 * One-tap single-vehicle share.
 *
 * `groupId` says WHICH group to invite into — needed since a vehicle may be in
 * several. Omit it and the server infers the target only when the vehicle is in
 * exactly one group the caller owns; faced with a choice it makes a fresh
 * one-vehicle group rather than guess, because attaching somebody to a
 * collection they were never shown is the one mistake this must not make.
 */
export function useShareVehicle(bikeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      email,
      role,
      groupId,
    }: {
      email: string;
      role: ShareInviteRole;
      groupId?: string;
    }) =>
      api<ShareInviteResult>(`/api/vehicle-shares/vehicles/${bikeId}/share`, {
        method: "POST",
        json: { email, role, ...(groupId ? { groupId } : {}) },
      }),
    onSuccess: () => invalidateGarage(qc),
  });
}

export function useInvitePreview(token: string | null) {
  return useQuery<ShareInvitePreview>({
    queryKey: ["vehicle-shares", "invite", token],
    queryFn: () => api<ShareInvitePreview>(`/api/vehicle-shares/invites/${token}`),
    enabled: !!token,
    retry: false,
  });
}

export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      api<ShareGroup>("/api/vehicle-shares/invites/accept", { method: "POST", json: { token } }),
    onSuccess: () => invalidateGarage(qc),
  });
}

// ─── claims ───────────────────────────────────────────────────────────────────

export function useIncomingClaims({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<IncomingClaim[]>({
    queryKey: INCOMING_CLAIMS_KEY,
    queryFn: () => api<IncomingClaim[]>("/api/vehicle-shares/claims/incoming"),
    staleTime: 60_000,
    enabled,
  });
}

export function useOutgoingClaims({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<OutgoingClaim[]>({
    queryKey: OUTGOING_CLAIMS_KEY,
    queryFn: () => api<OutgoingClaim[]>("/api/vehicle-shares/claims/outgoing"),
    staleTime: 60_000,
    enabled,
  });
}

export function useFileClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      claimToken,
      kind,
      message,
    }: {
      claimToken: string;
      kind: "access" | "purchase";
      message?: string;
    }) =>
      api<{ id: string }>("/api/vehicle-shares/claims", {
        method: "POST",
        json: { claimToken, kind, message },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: OUTGOING_CLAIMS_KEY }),
  });
}

export function useDecideClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      decision,
      role,
    }: {
      id: string;
      decision: "approve" | "decline";
      role?: ShareInviteRole;
    }) =>
      api<{ id: string; status: string }>(`/api/vehicle-shares/claims/${id}/${decision}`, {
        method: "POST",
        json: decision === "approve" ? { role: role ?? "guest" } : {},
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INCOMING_CLAIMS_KEY });
      invalidateGarage(qc);
    },
  });
}

/** The unresponsive-holder fallback: start a record of my own. */
export function useStartSeparateRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (claimId: string) =>
      api<{ bikeId: string }>(`/api/vehicle-shares/claims/${claimId}/separate-record`, {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OUTGOING_CLAIMS_KEY });
      invalidateGarage(qc);
    },
  });
}

export function useHandoverVehicle(bikeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) =>
      api<{ handoverId: string }>(`/api/vehicle-shares/vehicles/${bikeId}/handover`, {
        method: "POST",
        json: { email },
      }),
    onSuccess: () => invalidateGarage(qc),
  });
}

// ─── the duplicate 409 ────────────────────────────────────────────────────────

/**
 * Recognise "this vehicle is already tracked by somebody" and hand back the
 * opaque token that lets the user knock.
 *
 * Kept beside the hooks rather than in `lib/apiError.ts` because it is not an
 * error message — it is the entry point to a flow, and the token is a
 * capability the sheet has to carry.
 */
export function asDuplicateVehicle(e: unknown): DuplicateVehicle | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const body = e.body as Partial<DuplicateVehicle> | undefined;
  if (body?.error !== "vehicle_already_registered" || !body.claimToken || !body.matchedOn) {
    return null;
  }
  return { error: body.error, claimToken: body.claimToken, matchedOn: body.matchedOn };
}

/** The other 409: the duplicate is a vehicle the caller already has. */
export function asOwnDuplicate(e: unknown): { bikeId: string } | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const body = e.body as { error?: string; bikeId?: string } | undefined;
  if (body?.error !== "vehicle_already_in_garage" || !body.bikeId) return null;
  return { bikeId: body.bikeId };
}
