import { useEffect, useState } from "react";
import { useBikes } from "@/hooks/useBikes";
import { getActiveBikeId, storeActiveBikeId } from "@/hooks/useActiveBike";

/**
 * The vehicle a per-vehicle screen works on: the app-wide active vehicle,
 * defaulting to the first one and self-healing an id that no longer exists.
 * Changing it here changes it everywhere (dashboard, fuel, costs).
 */
export function useSelectedBike() {
  const bikes = useBikes();
  const [bikeId, setBikeId] = useState<string | undefined>(() => getActiveBikeId());

  useEffect(() => {
    if (!bikes.data || bikes.data.length === 0) return;
    if (!bikeId || !bikes.data.some((b) => b.id === bikeId)) setBikeId(bikes.data[0]!.id);
  }, [bikes.data, bikeId]);

  const select = (id: string) => {
    setBikeId(id);
    storeActiveBikeId(id);
  };
  const bike = bikes.data?.find((b) => b.id === bikeId);
  return { bikes, bikeId, bike, select };
}
