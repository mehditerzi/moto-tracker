import * as React from "react";
import { cn } from "@/lib/cn";
import { env } from "@/env";
import { vehicleIcon, vehicleTint, tintGradient, vehiclePhotoSrc } from "@/lib/vehicleType";
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
  /** Renders the glyph larger, for hero-sized tiles. */
  emphasis?: boolean;
  /** Set when no adjacent text names the vehicle. Otherwise the tile is
   *  decorative and stays out of the accessibility tree. */
  label?: string;
}

/**
 * One vehicle, drawn the same way everywhere: dashboard hero, garage list,
 * switcher pill, edit form.
 *
 * NO LAYOUT SHIFT, BY CONSTRUCTION. The tint is the element's own background
 * and the photo is an absolutely-positioned overlay inside it, so the box is
 * fully painted on first render and occupies its final size whether the photo
 * is loading, cached, slow or broken. Nothing here can reflow: there is no
 * `{photo ? <img/> : <div/>}` branch that changes the box, and no intrinsic
 * image size leaking into layout. A photo that 404s (a stale `?v=`, an org
 * upload the caller may no longer read) simply reveals the tint again.
 *
 * See lib/vehicleType.ts for why the fallback is a colour-derived tint rather
 * than stock or per-model photography.
 */
export function VehicleAvatar({
  vehicle,
  className,
  size = "full",
  previewSrc,
  emphasis,
  label,
}: VehicleAvatarProps) {
  const Icon = vehicleIcon(vehicle.vehicleType);
  const tint = vehicleTint(vehicle);
  const remote = vehiclePhotoSrc(vehicle.photoUrl, env.VITE_API_URL, size);
  const src = previewSrc ?? remote;

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
      className={cn("relative isolate overflow-hidden", className)}
      style={{ background: tintGradient(tint) }}
      // Announced only when there is a real photograph to announce, and only
      // where the caller says no adjacent text already names the vehicle. The
      // tint by itself is decoration — "Photo of Monster" on a vehicle with no
      // photo would be a plain untruth.
      {...(label && src ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {/* A single soft highlight. Enough to read as a surface with a light on
          it rather than a flat swatch, at zero asset cost. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(120% 90% at 22% 12%, rgba(255,255,255,0.16), transparent 62%)" }}
      />
      <Icon
        aria-hidden
        className={cn(
          "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
          emphasis ? "h-[38%] w-[38%]" : "h-1/2 w-1/2",
        )}
        style={{ color: tint.ink }}
        strokeWidth={1.5}
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
