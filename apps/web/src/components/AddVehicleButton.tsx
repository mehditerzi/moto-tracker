import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useEntitlement } from "@/hooks/useEntitlement";
import { PaywallSheet } from "@/components/PaywallSheet";

/**
 * The single entry point for "add a vehicle". If the user is within their
 * allowance it goes to the scan/capture flow; otherwise it opens the paywall
 * instead of letting them scan a vehicle they can't save. The API enforces the
 * same limit, so this is UX, not the security boundary.
 */
export function AddVehicleButton({
  children,
  size,
  variant = "accent",
  className,
}: {
  children: ReactNode;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  className?: string;
}) {
  const navigate = useNavigate();
  const { data } = useEntitlement();
  const [paywall, setPaywall] = useState(false);

  function onClick() {
    // While entitlement is still loading we optimistically proceed; the create
    // call will 403 as a backstop if the user is actually over the limit.
    if (data && !data.canAddVehicle) {
      setPaywall(true);
    } else {
      navigate("/capture");
    }
  }

  return (
    <>
      <Button size={size} variant={variant} className={className} onClick={onClick}>
        {children}
      </Button>
      <PaywallSheet open={paywall} onClose={() => setPaywall(false)} />
    </>
  );
}
