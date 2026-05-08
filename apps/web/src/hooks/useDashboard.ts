import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DashboardEntry } from "@mototracker/shared";

export function useDashboard() {
  return useQuery<DashboardEntry[]>({
    queryKey: ["dashboard"],
    queryFn: () => api<DashboardEntry[]>("/api/dashboard"),
  });
}
