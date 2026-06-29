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

export function useCreateBike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BikeCreateInput) => api<Bike>("/api/bikes", { method: "POST", json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
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
