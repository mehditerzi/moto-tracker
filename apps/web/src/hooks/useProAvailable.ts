import { useQuery } from "@tanstack/react-query";
import { PRO_PRODUCT_IDS } from "@mototracker/shared";
import { fetchProductCatalog, isNativeIapAvailable } from "@/lib/nativeIap";
import { useEntitlement } from "@/hooks/useEntitlement";

/**
 * Can Garajım Pro actually be bought here, right now?
 *
 * Every upsell asks this first, because the web app reaches every installed
 * binary the moment it deploys — including the weeks when the Pro products are
 * still in App Review and StoreKit simply does not return them. An offer that
 * opens onto "couldn't load" is worse than no offer.
 *
 *   native: StoreKit answers. A reviewer's sandbox device sees products that
 *           are in review, so App Review can find and buy Pro while ordinary
 *           users do not see it yet.
 *   web:    the server says Pro is live (`proLive`), or the user already has it.
 */
export function useProAvailable(): boolean {
  const ent = useEntitlement();
  const native = isNativeIapAvailable();
  const catalog = useQuery({
    queryKey: ["proCatalog"],
    queryFn: () => fetchProductCatalog([...PRO_PRODUCT_IDS]),
    enabled: native,
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (ent.data?.pro) return true;
  if (native) return (catalog.data?.products.length ?? 0) > 0;
  return ent.data?.proLive === true;
}
