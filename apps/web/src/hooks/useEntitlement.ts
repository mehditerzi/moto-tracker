import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { EntitlementSummary } from "@mototracker/shared";

export const ENTITLEMENT_KEY = ["entitlement"] as const;

/**
 * The user's current vehicle allowance and subscription state. Drives whether
 * the "add vehicle" action navigates to the scanner or opens the paywall.
 */
export function useEntitlement() {
  return useQuery<EntitlementSummary>({
    queryKey: ENTITLEMENT_KEY,
    queryFn: () => api<EntitlementSummary>("/api/entitlement"),
    // Cheap and cap-critical — keep it fresh-ish but don't hammer.
    staleTime: 30_000,
  });
}
