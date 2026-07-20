import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Trip, TripCreateInput } from "@mototracker/shared";

export function useTrips(bikeId?: string) {
  return useQuery<Trip[]>({
    queryKey: ["trips", bikeId ?? "all"],
    queryFn: () => api<Trip[]>(`/api/trips${bikeId ? `?bikeId=${encodeURIComponent(bikeId)}` : ""}`),
  });
}

/** One trip including its encoded route — fetched lazily when a map opens. */
export function useTrip(id: string | null) {
  return useQuery<Trip>({
    queryKey: ["trip", id],
    queryFn: () => api<Trip>(`/api/trips/${id}`),
    enabled: !!id,
    staleTime: Infinity, // a finished trip's route never changes
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
