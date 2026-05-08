import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MeResponse } from "@mototracker/shared";

export function useMe() {
  return useQuery<MeResponse>({
    queryKey: ["me"],
    queryFn: () => api<MeResponse>("/api/me"),
  });
}
