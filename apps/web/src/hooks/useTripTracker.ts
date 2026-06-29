import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { MIN_TRIP_KM } from "@mototracker/shared";
import { api } from "@/lib/api";
import {
  startTripTracking,
  useTripTrackingEnabled,
  type CompletedTrip,
} from "@/lib/tripTracking";
import { getActiveBikeId } from "@/hooks/useActiveBike";
import { pushToast } from "@/hooks/useToast";
import { track } from "@/lib/telemetry";

/**
 * App-wide trip tracker. While enabled, it watches location, auto-detects
 * drives, and on a completed trip ≥ MIN_TRIP_KM logs it against the currently
 * active vehicle. Mounted once in AppShell so it runs regardless of route.
 * Best-effort: a failed save is swallowed so it never disrupts the user.
 */
export function useTripTracker(): void {
  const enabled = useTripTrackingEnabled();
  const qc = useQueryClient();
  const { t } = useTranslation();

  useEffect(() => {
    if (!enabled) return;
    const handle = startTripTracking({
      backgroundTitle: t("trips.bgTitle"),
      backgroundMessage: t("trips.bgMessage"),
      onTrip: (trip: CompletedTrip) => {
        // The ≥15 km rule is also enforced server-side; filter here too so we
        // don't POST short hops that would just be rejected.
        if (trip.distanceKm < MIN_TRIP_KM) return;
        const bikeId = getActiveBikeId();
        if (!bikeId) return;
        void (async () => {
          try {
            await api("/api/trips", { method: "POST", json: { bikeId, ...trip } });
            qc.invalidateQueries({ queryKey: ["trips"] });
            track("trip_logged", { km: trip.distanceKm, points: trip.pointCount });
            pushToast({
              variant: "success",
              title: t("trips.logged", { km: Math.round(trip.distanceKm) }),
            });
          } catch {
            /* best-effort telemetry/logging — never interrupt the drive */
          }
        })();
      },
    });
    return () => handle.stop();
  }, [enabled, qc, t]);
}
