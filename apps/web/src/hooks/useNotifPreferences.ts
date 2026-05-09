import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { NotifPreference } from "@mototracker/shared";

export function useNotifPrefs() {
  return useQuery<NotifPreference[]>({
    queryKey: ["notif-prefs"],
    queryFn: () => api<NotifPreference[]>("/api/notification-preferences"),
  });
}

export function useUpdateNotifPref(itemType: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { leadDays: number[]; enabled: boolean }) =>
      api<NotifPreference>(`/api/notification-preferences/${itemType}`, {
        method: "PUT",
        json: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notif-prefs"] }),
  });
}
