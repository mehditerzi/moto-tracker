import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/** Why the paywall opened — it leads with the thing the user just reached for. */
export type PaywallReason = "vehicles" | "scans" | "export" | "glovebox" | "generic";

interface PaywallApi {
  openPaywall: (reason?: PaywallReason) => void;
}

const Ctx = createContext<PaywallApi>({ openPaywall: () => {} });

// The sheet pulls in StoreKit glue and the whole offer UI; nobody who never
// meets a limit should download it.
const ProPaywallSheet = lazy(() =>
  import("@/components/paywall/ProPaywallSheet").then((m) => ({ default: m.ProPaywallSheet })),
);

/**
 * One paywall for the whole app. Any screen that meets a plan limit calls
 * `openPaywall(reason)` instead of mounting its own sheet, so the offer, the
 * copy and the purchase flow exist in exactly one place.
 */
export function PaywallProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; reason: PaywallReason; mounted: boolean }>({
    open: false,
    reason: "generic",
    mounted: false,
  });
  const openPaywall = useCallback((reason: PaywallReason = "generic") => {
    setState({ open: true, reason, mounted: true });
  }, []);
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  const value = useMemo(() => ({ openPaywall }), [openPaywall]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {state.mounted && (
        <Suspense fallback={null}>
          <ProPaywallSheet open={state.open} reason={state.reason} onClose={close} />
        </Suspense>
      )}
    </Ctx.Provider>
  );
}

export function usePaywall(): PaywallApi {
  return useContext(Ctx);
}
