import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Bike, BikeCreateInput, BikeUpdateInput } from "@mototracker/shared";

const KEY = ["bikes"] as const;

export function useBikes() {
  return useQuery<Bike[]>({
    queryKey: KEY,
    queryFn: () => api<Bike[]>("/api/bikes"),
  });
}

export function useBike(id: string | undefined) {
  return useQuery<Bike>({
    queryKey: ["bikes", id],
    queryFn: () => api<Bike>(`/api/bikes/${id}`),
    enabled: !!id,
  });
}

/**
 * `orgId` puts the new vehicle in an ORGANIZATION's garage instead of the
 * caller's personal one. It is not part of `BikeCreateInput` (packages/shared
 * keeps the vehicle's own attributes separate from where it is filed) and the
 * API parses it from the same body with its own schema — see
 * `bikeOrgSchema` in apps/api/src/routes/bikes.ts.
 *
 * Deliberately create-only: `bikeUpdateSchema` omits `orgId` and PATCH ignores
 * it, because moving a vehicle between garages changes both who can see it and
 * which subscription pays for it. There is no client affordance for it either.
 */
export type BikeCreateInputWithOrg = BikeCreateInput & { orgId?: string };

export function useCreateBike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BikeCreateInputWithOrg) =>
      api<Bike>("/api/bikes", { method: "POST", json: input }),
    onSuccess: (_bike, input) => {
      qc.invalidateQueries({ queryKey: KEY });
      // An org vehicle has to show up on the fleet screens too; every fleet
      // cache is keyed ["fleet", orgId, …] (hooks/useFleetData.ts).
      if (input.orgId) qc.invalidateQueries({ queryKey: ["fleet", input.orgId] });
    },
  });
}

export function useUpdateBike(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BikeUpdateInput) => api<Bike>(`/api/bikes/${id}`, { method: "PATCH", json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useUploadBikePhoto(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api<Bike>(`/api/bikes/${id}/photo`, { method: "POST", body: fd });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["bikes", id] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeleteBikePhoto(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(`/api/bikes/${id}/photo`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["bikes", id] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useArchiveBike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/bikes/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
