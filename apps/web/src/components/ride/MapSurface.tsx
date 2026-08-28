import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export type MapState = "loading" | "ready" | "failed";

/**
 * The map itself, edge to edge, plus the two states a rider can do nothing
 * about: still loading, or failed outright (the CDN script blocked,
 * /api/mapkit-token answering 503 because MapKit is unconfigured). The failure
 * state says so and offers a retry rather than leaving a blank rectangle that
 * reads as a bug.
 */
export function MapSurface({
  innerRef,
  state,
  onRetry,
  label,
}: {
  innerRef: RefObject<HTMLDivElement>;
  state: MapState;
  onRetry: () => void;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0">
      <div ref={innerRef} role="region" aria-label={label} className="h-full w-full" />
      {state === "loading" && (
        <div className="absolute inset-0 animate-pulse bg-surface-elev dark:bg-surface-elev-dark" />
      )}
      {state === "failed" && (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-elev p-6 text-center dark:bg-surface-elev-dark"
        >
          <AlertTriangle className="h-6 w-6 text-warning" strokeWidth={1.7} />
          <p className="text-[14px] text-muted dark:text-muted-dark">{t("map.mapFailed")}</p>
          <Button size="lg" variant="outline" onClick={onRetry}>
            <RotateCw className="h-5 w-5" /> {t("common.retry")}
          </Button>
        </div>
      )}
    </div>
  );
}
