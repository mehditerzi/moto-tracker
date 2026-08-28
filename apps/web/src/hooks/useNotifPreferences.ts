import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { NotifCategoryPreference, NotifPreference } from "@mototracker/shared";

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

/**
 * Notification CATEGORIES — sharing activity, as opposed to the expiry
 * reminders above. A separate query rather than an extra row in the same list
 * because it is a different shape (no lead days) and a different question: when
 * do you want to be warned about a date, versus do you want to hear about the
 * people you share with at all.
 */
export function useNotifCategories() {
  return useQuery<NotifCategoryPreference[]>({
    queryKey: ["notif-categories"],
    queryFn: () => api<NotifCategoryPreference[]>("/api/notification-preferences/categories"),
  });
}

export function useUpdateNotifCategory(category: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { enabled: boolean }) =>
      api<NotifCategoryPreference>(`/api/notification-preferences/categories/${category}`, {
        method: "PUT",
        json: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notif-categories"] }),
  });
}
