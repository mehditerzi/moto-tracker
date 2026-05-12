import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getCurrentSubscription,
  getPushPublicKey,
  subscribePushOnDevice,
  unsubscribePushOnDevice,
} from "@/lib/push";
import { api } from "@/lib/api";

export function usePushStatus() {
  return useQuery({
    queryKey: ["push", "status"],
    queryFn: async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window;
      const permission: NotificationPermission | "unsupported" = supported
        ? Notification.permission
        : "unsupported";
      let subscribed = false;
      if (supported) {
        try {
          const sub = await getCurrentSubscription();
          subscribed = !!sub;
        } catch {
          // Service worker not registered yet (e.g. dev mode) — treat as not subscribed.
          subscribed = false;
        }
      }
      return { supported, permission, subscribed };
    },
    retry: false,
    staleTime: 5_000,
  });
}

export function useEnablePush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const key = await getPushPublicKey();
      if (!key) throw new Error("VAPID public key not configured on server");
      return subscribePushOnDevice(key);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["push"] }),
  });
}

export function useDisablePush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unsubscribePushOnDevice(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["push"] }),
  });
}

export function useSendTestPush() {
  return useMutation({
    mutationFn: () => api<{ sent: number; total: number; error: string | null }>("/api/push/test", { method: "POST" }),
  });
}
