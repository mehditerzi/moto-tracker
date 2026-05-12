import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import type { MeResponse } from "@mototracker/shared";

export function useMe() {
  return useQuery<MeResponse>({
    queryKey: ["me"],
    queryFn: () => api<MeResponse>("/api/me"),
    // 401 means "not signed in" — don't retry, just bubble up so RequireAuth
    // can redirect immediately.
    retry: (_count, err) => {
      if (err instanceof ApiError && err.status === 401) return false;
      return _count < 1;
    },
    staleTime: 30_000,
  });
}
