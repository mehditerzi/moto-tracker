import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  FleetCostResponse,
  FleetImportPreview,
  FleetImportResult,
  FleetInventoryResponse,
  FleetInventorySort,
  FleetStatus,
  FleetTriageResponse,
  FleetCustomer,
  FleetCustomerCreateInput,
  OrgDetail,
  OrgMode,
  OrgRole,
} from "@mototracker/shared";

/**
 * Every read and write the fleet screens make.
 *
 * A few response shapes below are declared locally rather than imported from
 * `@mototracker/shared`: the member list, the invite list, the assignment ledger
 * and the contract list are composed in their routes (they join a user or a
 * customer onto the row) and have no exported schema. They are transcribed from
 * apps/api/src/routes/orgMembers.ts, orgFleet.ts and orgContracts.ts — the
 * routes are the contract, not this file.
 *
 * QUERY KEYS are all prefixed `["fleet", orgId, …]` so switching org, or
 * invalidating after a write, never touches the consumer app's caches.
 */

const base = (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}`;
const key = (orgId: string, ...rest: unknown[]) => ["fleet", orgId, ...rest] as const;

// ─── org ──────────────────────────────────────────────────────────────────────

export function useOrgDetail(orgId: string | undefined) {
  return useQuery<OrgDetail>({
    queryKey: key(orgId ?? "", "detail"),
    queryFn: () => api<OrgDetail>(base(orgId!)),
    enabled: !!orgId,
    staleTime: 60_000,
  });
}

// ─── triage board ─────────────────────────────────────────────────────────────

export function useFleetTriage(orgId: string | undefined, horizonDays = 30) {
  return useQuery<FleetTriageResponse>({
    queryKey: key(orgId ?? "", "triage", horizonDays),
    queryFn: () => api<FleetTriageResponse>(`${base(orgId!)}/triage?horizonDays=${horizonDays}`),
    enabled: !!orgId,
  });
}

// ─── inventory ────────────────────────────────────────────────────────────────

export interface InventoryParams {
  q?: string;
  status?: FleetStatus;
  holder?: string;
  sort: FleetInventorySort;
  dir: "asc" | "desc";
  includeArchived?: boolean;
}

export function useFleetInventory(orgId: string | undefined, params: InventoryParams) {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.status) qs.set("status", params.status);
  if (params.holder) qs.set("holder", params.holder);
  qs.set("sort", params.sort);
  qs.set("dir", params.dir);
  // The API refuses to coerce this one (Boolean("false") is true), so send the
  // literal it compares against, and only when it is actually on.
  if (params.includeArchived) qs.set("includeArchived", "true");
  const search = qs.toString();
  return useQuery<FleetInventoryResponse>({
    queryKey: key(orgId ?? "", "inventory", search),
    queryFn: () => api<FleetInventoryResponse>(`${base(orgId!)}/vehicles?${search}`),
    enabled: !!orgId,
    // Keeps the table on screen while a sort/filter round-trips instead of
    // flashing a skeleton on every header click.
    placeholderData: (prev) => prev,
  });
}

export interface FleetVehicleHistory {
  bikeId: string;
  assignments: {
    id: string;
    userId: string;
    userName: string | null;
    userEmail: string | null;
    startedAt: string;
    endedAt: string | null;
    startKm: number | null;
    endKm: number | null;
  }[];
  contracts: {
    id: string;
    customerId: string;
    customerName: string | null;
    startedAt: string;
    endsAt: string | null;
    returnedAt: string | null;
    handoverKm: number | null;
    returnKm: number | null;
    dailyRate: number | null;
    currency: string;
    status: "open" | "returned" | "cancelled";
  }[];
}

export function useFleetVehicleHistory(orgId: string | undefined, bikeId: string | undefined) {
  return useQuery<FleetVehicleHistory>({
    queryKey: key(orgId ?? "", "history", bikeId),
    queryFn: () =>
      api<FleetVehicleHistory>(`${base(orgId!)}/vehicles/${encodeURIComponent(bikeId!)}/history`),
    enabled: !!orgId && !!bikeId,
  });
}

// ─── costs ────────────────────────────────────────────────────────────────────

export function useFleetCosts(orgId: string | undefined, from?: string, to?: string) {
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const search = qs.toString();
  return useQuery<FleetCostResponse>({
    queryKey: key(orgId ?? "", "costs", search),
    queryFn: () => api<FleetCostResponse>(`${base(orgId!)}/costs${search ? `?${search}` : ""}`),
    enabled: !!orgId,
  });
}

// ─── members & invites ────────────────────────────────────────────────────────

export interface FleetMember {
  orgId: string;
  userId: string;
  role: OrgRole;
  status: "active" | "removed";
  joinedAt: string;
  email: string | null;
  name: string | null;
  isSelf: boolean;
  assignments: { bikeId: string; plate: string | null; nickname: string; startedAt: string }[];
}

export function useFleetMembers(orgId: string | undefined, enabled = true) {
  return useQuery<FleetMember[]>({
    queryKey: key(orgId ?? "", "members"),
    queryFn: () => api<FleetMember[]>(`${base(orgId!)}/members`),
    enabled: !!orgId && enabled,
  });
}

export interface FleetInvite {
  id: string;
  orgId: string;
  email: string;
  role: OrgRole;
  expiresAt: string;
  acceptedAt: string | null;
  invitedBy: string | null;
  createdAt: string;
  expired: boolean;
}

export function useFleetInvites(orgId: string | undefined, enabled = true) {
  return useQuery<FleetInvite[]>({
    queryKey: key(orgId ?? "", "invites"),
    queryFn: () => api<FleetInvite[]>(`${base(orgId!)}/invites`),
    enabled: !!orgId && enabled,
  });
}

export interface CreatedInvite {
  invite: FleetInvite;
  /** The one and only time the token is readable. Never persisted anywhere. */
  token: string;
  acceptUrl: string;
}

export function useCreateInvite(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; role: OrgRole }) =>
      api<CreatedInvite>(`${base(orgId)}/invites`, { method: "POST", json: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key(orgId, "invites") }),
  });
}

export function useRevokeInvite(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`${base(orgId)}/invites/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key(orgId, "invites") }),
  });
}

export function useSetMemberRole(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: OrgRole }) =>
      api<{ role: OrgRole }>(`${base(orgId)}/members/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        json: { role },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key(orgId, "members") }),
  });
}

export function useRemoveMember(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api<void>(`${base(orgId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key(orgId, "members") });
      void qc.invalidateQueries({ queryKey: key(orgId, "inventory") });
    },
  });
}

// ─── assignments (fleet mode) ─────────────────────────────────────────────────

export interface FleetAssignment {
  id: string;
  orgId: string;
  bikeId: string;
  userId: string;
  startedAt: string;
  endedAt: string | null;
  startKm: number | null;
  endKm: number | null;
  bike: { id: string; plate: string | null; nickname: string };
  user: { id: string; email: string | null; name: string | null };
}

export function useOpenAssignmentFor(orgId: string | undefined, bikeId: string | undefined, on: boolean) {
  return useQuery<FleetAssignment[]>({
    queryKey: key(orgId ?? "", "assignments", bikeId),
    queryFn: () =>
      api<FleetAssignment[]>(
        `${base(orgId!)}/assignments?bikeId=${encodeURIComponent(bikeId!)}&open=true`,
      ),
    enabled: !!orgId && !!bikeId && on,
  });
}

/** Invalidate everything that shows "who has this vehicle". */
function invalidateHolders(qc: ReturnType<typeof useQueryClient>, orgId: string) {
  void qc.invalidateQueries({ queryKey: ["fleet", orgId] });
}

export function useAssignVehicle(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { bikeId: string; userId: string; startKm?: number | null }) =>
      api<FleetAssignment>(`${base(orgId)}/assignments`, { method: "POST", json: input }),
    onSuccess: () => invalidateHolders(qc, orgId),
  });
}

export function useEndAssignment(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, endKm }: { id: string; endKm?: number | null }) =>
      api<FleetAssignment>(`${base(orgId)}/assignments/${encodeURIComponent(id)}/end`, {
        method: "POST",
        json: { endKm: endKm ?? null },
      }),
    onSuccess: () => invalidateHolders(qc, orgId),
  });
}

// ─── customers & contracts (rental mode) ──────────────────────────────────────

export interface FleetCustomerRow extends FleetCustomer {
  openContracts: number;
  totalContracts: number;
}

export function useFleetCustomers(orgId: string | undefined, q: string, enabled = true) {
  return useQuery<FleetCustomerRow[]>({
    queryKey: key(orgId ?? "", "customers", q),
    queryFn: () =>
      api<FleetCustomerRow[]>(`${base(orgId!)}/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    enabled: !!orgId && enabled,
    placeholderData: (prev) => prev,
  });
}

export function useCreateCustomer(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FleetCustomerCreateInput) =>
      api<FleetCustomerRow>(`${base(orgId)}/customers`, { method: "POST", json: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key(orgId, "customers") }),
  });
}

export function useDeleteCustomer(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`${base(orgId)}/customers/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => invalidateHolders(qc, orgId),
  });
}

export interface FleetContract {
  id: string;
  orgId: string;
  bikeId: string;
  customerId: string;
  startedAt: string;
  endsAt: string | null;
  returnedAt: string | null;
  handoverKm: number | null;
  returnKm: number | null;
  dailyRate: number | null;
  currency: string;
  status: "open" | "returned" | "cancelled";
  notes: string | null;
  bike: { id: string; plate: string | null; nickname: string };
  customer: { id: string; name: string | null };
  distanceKm: number | null;
}

export function useFleetContracts(
  orgId: string | undefined,
  opts: { status?: "open" | "returned" | "cancelled" | "all"; bikeId?: string; customerId?: string } = {},
  enabled = true,
) {
  const qs = new URLSearchParams();
  qs.set("status", opts.status ?? "open");
  if (opts.bikeId) qs.set("bikeId", opts.bikeId);
  if (opts.customerId) qs.set("customerId", opts.customerId);
  const search = qs.toString();
  return useQuery<FleetContract[]>({
    queryKey: key(orgId ?? "", "contracts", search),
    queryFn: () => api<FleetContract[]>(`${base(orgId!)}/contracts?${search}`),
    enabled: !!orgId && enabled,
  });
}

export function useCreateContract(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      bikeId: string;
      customerId: string;
      endsAt?: string | null;
      handoverKm?: number | null;
      dailyRate?: number | null;
      notes?: string | null;
    }) => api<FleetContract>(`${base(orgId)}/contracts`, { method: "POST", json: input }),
    onSuccess: () => invalidateHolders(qc, orgId),
  });
}

export function useCloseContract(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, returnKm }: { id: string; returnKm?: number | null }) =>
      api<FleetContract>(`${base(orgId)}/contracts/${encodeURIComponent(id)}/close`, {
        method: "POST",
        json: { returnKm: returnKm ?? null },
      }),
    onSuccess: () => invalidateHolders(qc, orgId),
  });
}

export function useCancelContract(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<FleetContract>(`${base(orgId)}/contracts/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
      }),
    onSuccess: () => invalidateHolders(qc, orgId),
  });
}

// ─── CSV import ───────────────────────────────────────────────────────────────

export interface ImportInput {
  csv: string;
  delimiter?: "," | ";" | "\t" | "|";
}

export function usePreviewImport(orgId: string) {
  return useMutation({
    mutationFn: (input: ImportInput) =>
      api<FleetImportPreview>(`${base(orgId)}/import/vehicles/preview`, {
        method: "POST",
        json: input,
      }),
  });
}

export function useCommitImport(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportInput) =>
      api<FleetImportResult>(`${base(orgId)}/import/vehicles/commit`, {
        method: "POST",
        json: input,
      }),
    onSuccess: () => {
      invalidateHolders(qc, orgId);
      // Imported vehicles are also the caller's own garage listing.
      void qc.invalidateQueries({ queryKey: ["bikes"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// ─── redeeming an invitation ──────────────────────────────────────────────────

export interface InvitePreview {
  orgName: string;
  mode: OrgMode;
  role: OrgRole;
  email: string;
  expiresAt: string;
  emailMatches: boolean;
}

export function previewInvite(token: string) {
  return api<InvitePreview>("/api/org-invites/preview", { method: "POST", json: { token } });
}

export function acceptInvite(token: string) {
  return api<{ orgId: string; name: string; mode: OrgMode; role: OrgRole }>(
    "/api/org-invites/accept",
    { method: "POST", json: { token } },
  );
}
