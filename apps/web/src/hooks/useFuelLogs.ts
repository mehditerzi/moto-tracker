import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { FuelLog, FuelLogCreateInput } from "@mototracker/shared";

export function useFuelLogs(bikeId?: string) {
  return useQuery<FuelLog[]>({
    queryKey: ["fuelLogs", bikeId ?? "all"],
    queryFn: () =>
      api<FuelLog[]>(`/api/fuel-logs${bikeId ? `?bikeId=${encodeURIComponent(bikeId)}` : ""}`),
    enabled: !!bikeId,
  });
}

export function useCreateFuelLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FuelLogCreateInput) =>
      api<FuelLog>("/api/fuel-logs", { method: "POST", json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fuelLogs"] }),
  });
}

export function useDeleteFuelLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/fuel-logs/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fuelLogs"] }),
  });
}
