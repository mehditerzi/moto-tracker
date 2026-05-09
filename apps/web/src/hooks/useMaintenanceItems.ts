import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MaintenanceItem, MaintenanceCreateInput, MaintenanceUpdateInput } from "@mototracker/shared";

export function useMaintenanceForBike(bikeId: string | undefined) {
  return useQuery<MaintenanceItem[]>({
    queryKey: ["maintenance", "bike", bikeId],
    queryFn: () => api<MaintenanceItem[]>(`/api/bikes/${bikeId}/maintenance-items`),
    enabled: !!bikeId,
  });
}

export function useMaintenanceItem(id: string | undefined) {
  return useQuery<MaintenanceItem>({
    queryKey: ["maintenance", id],
    queryFn: () => api<MaintenanceItem>(`/api/maintenance-items/${id}`),
    enabled: !!id,
  });
}

export function useCreateMaintenance(bikeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MaintenanceCreateInput) =>
      api<MaintenanceItem>(`/api/bikes/${bikeId}/maintenance-items`, { method: "POST", json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance", "bike", bikeId] });
    },
  });
}

export function useUpdateMaintenance(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MaintenanceUpdateInput) =>
      api<MaintenanceItem>(`/api/maintenance-items/${id}`, { method: "PATCH", json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance"] });
    },
  });
}

export function useDeleteMaintenance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/maintenance-items/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["maintenance"] }),
  });
}
