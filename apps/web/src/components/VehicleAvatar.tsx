import * as React from "react";
import { cn } from "@/lib/cn";
import { env } from "@/env";
import { vehiclePhotoSrc } from "@/lib/vehicleType";
import { vehicleArtFor } from "@/lib/vehicleArt";
import type { VehicleType } from "@mototracker/shared";

/** The subset of a vehicle this needs. Loose so DashboardEntry, Bike and a
 *  half-filled form draft all satisfy it without a cast. */
export interface AvatarVehicle {
  id?: string | null;
  vehicleType?: VehicleType | null;
  nickname?: string | null;
  make?: string | null;
  model?: string | null;
  color?: string | null;
  cylinderCc?: number | null;
  photoUrl?: string | null;
}

export interface VehicleAvatarProps {
  vehicle: AvatarVehicle;
  /** Sizes and shapes the box. MUST establish a height (or an aspect ratio) —
   *  see the layout-shift note below. */
  className?: string;
  /** Which stored derivative to request. `thumb` is 320×240; use it for
   *  anything smaller than ~160px on screen. */
  size?: "thumb" | "full";
  /** Overrides the photo URL — used for an optimistic local preview during an
   *  upload, so the tile shows the new photo before the server has it. */
  previewSrc?: string | null;
  /** Hero-sized tile: the illustration sits smaller, with room around it. */
  emphasis?: boolean;
  /** Set when no adjacent text names the vehicle. Otherwise the tile is
   *  decorative and stays out of the accessibility tree. */
  label?: string;
}

/**
 * One vehicle, drawn the same way everywhere: dashboard hero, garage list,
 * switcher pill, edit form, share cards.
 *
 * Without a photo it shows the studio illustration from lib/vehicleArt.ts — the
 * vehicle's body style in its recorded colour on a neutral backdrop — so a
 * garage reads as a garage, not as a column of placeholders. With a photo, the
 * photo fades in over it.
 *
 * NO LAYOUT SHIFT, BY CONSTRUCTION. The backdrop and illustration are painted
 * on first render and the photo is an absolutely-positioned overlay, so the box
 * occupies its final size whether the photo is loading, cached, slow or broken.
 * A photo that 404s simply reveals the illustration again.
 */
export function VehicleAvatar({
  vehicle,
  className,
  size = "full",
  previewSrc,
  emphasis,
  label,
}: VehicleAvatarProps) {
  const remote = vehiclePhotoSrc(vehicle.photoUrl, env.VITE_API_URL, size);
  const src = previewSrc ?? remote;
  // The studio illustration (lib/vehicleArt.ts): body style from make/model,
  // paint from the recorded colour. Memoised on exactly what changes it.
  const art = React.useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(vehicleArtFor(vehicle).svg)}`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vehicle.id, vehicle.vehicleType, vehicle.make, vehicle.model, vehicle.color, vehicle.cylinderCc, vehicle.nickname],
  );

  const [failed, setFailed] = React.useState(false);
  // Sticky once anything has painted, and deliberately NOT reset when `src`
  // changes. The same <img> element keeps showing its previous frame while a
  // new src decodes, so holding opacity at 1 means swapping a local upload
  // preview for the stored photo — or replacing a photo outright — is a
  // straight cut. Resetting it flashed the bare tint in between.
  const [painted, setPainted] = React.useState(false);
  React.useEffect(() => {
    // A failure must not outlive the source that caused it, or a retry after a
    // 404 would never render. Losing the source entirely (photo removed) starts
    // the fade over.
    setFailed(false);
    if (!src) setPainted(false);
  }, [src]);

  return (
    <div
      className={cn(
        "relative isolate overflow-hidden bg-gradient-to-b from-[#f6f7f9] to-[#dde1e6] dark:from-[#25282e] dark:to-[#111317]",
        className,
      )}
      // Announced only when there is a real photograph to announce, and only
      // where the caller says no adjacent text already names the vehicle. The
      // illustration is decoration — "Photo of Monster" on a drawing would be a
      // plain untruth.
      {...(label && src ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {/* Studio light: a soft spot behind the vehicle. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70 dark:opacity-40"
        style={{ background: "radial-gradient(70% 60% at 50% 38%, rgba(255,255,255,0.9), transparent 70%)" }}
      />
      <img
        src={art}
        alt=""
        aria-hidden
        draggable={false}
        className={cn(
          "pointer-events-none absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-[46%] select-none",
          emphasis ? "w-[min(62%,420px)]" : "w-[124%]",
        )}
      />
      {src && !failed && (
        <img
          src={src}
          alt=""
          // Decorative: every call site names the vehicle in adjacent text, and
          // an `alt` of "photo of Monster" next to the word "Monster" is noise
          // to a screen reader. When there is no adjacent text the caller passes
          // `label`, which describes the whole tile instead.
          aria-hidden
          loading="lazy"
          decoding="async"
          onLoad={() => setPainted(true)}
          onError={() => setFailed(true)}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-200",
            painted ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </div>
  );
}
