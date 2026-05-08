import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  DatedItem,
  DatedItemCreateInput,
  DatedItemUpdateInput,
} from "@mototracker/shared";

export function useDatedItemsForBike(bikeId: string | undefined) {
  return useQuery<DatedItem[]>({
    queryKey: ["dated-items", "bike", bikeId],
    queryFn: () => api<DatedItem[]>(`/api/bikes/${bikeId}/dated-items`),
    enabled: !!bikeId,
  });
}

export function useDatedItem(id: string | undefined) {
  return useQuery<DatedItem>({
    queryKey: ["dated-items", id],
    queryFn: () => api<DatedItem>(`/api/dated-items/${id}`),
    enabled: !!id,
  });
}

export function useCreateDatedItem(bikeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DatedItemCreateInput) =>
      api<DatedItem>(`/api/bikes/${bikeId}/dated-items`, { method: "POST", json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dated-items", "bike", bikeId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useUpdateDatedItem(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DatedItemUpdateInput) =>
      api<DatedItem>(`/api/dated-items/${id}`, { method: "PATCH", json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dated-items"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeleteDatedItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/dated-items/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dated-items"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
