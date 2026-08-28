import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { IAP_PRODUCT_IDS } from "@mototracker/shared";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useEntitlement } from "@/hooks/useEntitlement";
import { addVehicleIntent } from "@/pages/fleet/vehicleTarget";
import { PaywallSheet } from "@/components/PaywallSheet";
import { fetchProductCatalog, isNativeIapAvailable } from "@/lib/nativeIap";

/**
 * The single entry point for "add a vehicle". If the user is within their
 * allowance it goes to the scan/capture flow; otherwise it opens the paywall
 * instead of letting them scan a vehicle they can't save. The API enforces the
 * same limit, so this is UX, not the security boundary.
 *
 * With `orgId` it adds to an ORGANIZATION's garage instead (the fleet inventory
 * passes it). That path is a different product: the ceiling is the org's, sold
 * offline, so the consumer paywall is not merely unnecessary but forbidden —
 * docs/fleet-design.md §1 / App Store Guideline 3.1.1. Hence no entitlement
 * query, no StoreKit warm-up and no `<PaywallSheet>` in the tree at all; the
 * decision itself lives in `addVehicleIntent`.
 */
export function AddVehicleButton({
  children,
  size,
  variant = "accent",
  className,
  orgId,
  disabled,
}: {
  children: ReactNode;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  className?: string;
  /** Target organization. Omit for the consumer's personal garage. */
  orgId?: string;
  disabled?: boolean;
}) {
  const navigate = useNavigate();
  const { data } = useEntitlement({ enabled: !orgId });
  const [paywall, setPaywall] = useState(false);

  // The user is already at the cap, so the next tap opens the paywall. Warm the
  // StoreKit catalogue now (it's cached in nativeIap) so the sheet opens with
  // real App Store prices instead of a spinner at the moment of intent.
  const atLimit = !orgId && data ? !data.canAddVehicle : false;
  useEffect(() => {
    if (!atLimit || !isNativeIapAvailable()) return;
    void fetchProductCatalog([...IAP_PRODUCT_IDS]).catch(() => {
      /* the paywall retries and reports properly */
    });
  }, [atLimit]);

  function onClick() {
    const intent = addVehicleIntent(orgId, data);
    if (intent.kind === "paywall") setPaywall(true);
    else navigate(intent.to);
  }

  return (
    <>
      <Button size={size} variant={variant} className={className} onClick={onClick} disabled={disabled}>
        {children}
      </Button>
      {!orgId && <PaywallSheet open={paywall} onClose={() => setPaywall(false)} />}
    </>
  );
}
