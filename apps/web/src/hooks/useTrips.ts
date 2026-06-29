import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Trip, TripCreateInput } from "@mototracker/shared";

export function useTrips(bikeId?: string) {
  return useQuery<Trip[]>({
    queryKey: ["trips", bikeId ?? "all"],
    queryFn: () => api<Trip[]>(`/api/trips${bikeId ? `?bikeId=${encodeURIComponent(bikeId)}` : ""}`),
  });
}

export function useCreateTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TripCreateInput) =>
      api<Trip>("/api/trips", { method: "POST", json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trips"] }),
  });
}
