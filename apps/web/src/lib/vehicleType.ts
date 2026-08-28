import { Bike, Car, type LucideIcon } from "lucide-react";
import type { VehicleType } from "@mototracker/shared";

/**
 * The lucide icon for a vehicle type. Cars get the car glyph, everything else
 * (motorcycles, or an unknown/null type) falls back to the bike glyph — the
 * app's original default. Centralized here so every surface that shows a vehicle
 * (dashboard hero, switcher, list rows) stays consistent.
 */
export function vehicleIcon(type: VehicleType | null | undefined): LucideIcon {
  return type === "car" ? Car : Bike;
}

// ─── vehicle imagery ──────────────────────────────────────────────────────────

/**
 * WHY THERE IS NO STOCK PHOTO HERE.
 *
 * A vehicle with no uploaded photo used to render a grey lucide glyph, which is
 * the same grey lucide glyph on every other vehicle — a garage of five looked
 * like five copies of one thing. The obvious fix, per-model photography, is not
 * available to us on any legitimate terms: manufacturer press images are
 * licensed for editorial use by press, not for redistribution inside a
 * commercial app; the stock libraries that do license vehicle photography do so
 * per-image, which does not survive a 2,000-model catalog; and scraping either
 * one is a licensing problem wearing a technical disguise. So there is no
 * per-model imagery, and there is no third-party image request anywhere in this
 * file — nothing is fetched, hotlinked or bundled.
 *
 * What we build instead is an IDENTITY TINT: a deterministic two-stop gradient
 * derived from the colour the owner already recorded on the vehicle (D.7 on the
 * ruhsat, which the scanner fills in automatically). A red Egea and a white
 * Doblo are then instantly distinguishable in the switcher, the list and the
 * hero — which is the actual job, and the thing a generic silhouette of "a
 * hatchback" would not do. When no colour is recorded we fall back to a stable
 * hash of the vehicle's own id, so a given vehicle always looks like itself.
 *
 * Everything rendered is ours: two CSS colour stops and a lucide glyph (ISC,
 * already a dependency). Legally clean, offline, and zero bytes of assets.
 */
export interface VehicleTint {
  /** Gradient start (top-left). */
  from: string;
  /** Gradient end (bottom-right). */
  to: string;
  /** Foreground that is legible on this tint, in BOTH themes — the tile carries
   *  its own background, so it must carry its own contrast too. */
  ink: string;
}

const LIGHT_INK = "rgba(255,255,255,0.82)";
const DARK_INK = "rgba(17,18,22,0.55)";

/**
 * Turkish colour vocabulary → a muted two-stop tint. Deliberately desaturated:
 * the design language reserves saturation for the lime accent and for status,
 * so an identity tint that shouted would compete with the things that mean
 * something (docs/fleet-design.md §6, "scarce accent").
 *
 * Keys are normalized (see `normColor`). English synonyms are included because
 * a CSV import or an English-language ruhsat transcription reaches this too.
 */
const COLOR_TINTS: Record<string, VehicleTint> = {
  BEYAZ: { from: "#EDEEF0", to: "#C4C8CE", ink: DARK_INK },
  WHITE: { from: "#EDEEF0", to: "#C4C8CE", ink: DARK_INK },
  SIYAH: { from: "#33363C", to: "#111318", ink: LIGHT_INK },
  BLACK: { from: "#33363C", to: "#111318", ink: LIGHT_INK },
  GRI: { from: "#9CA2A9", to: "#666C73", ink: LIGHT_INK },
  GREY: { from: "#9CA2A9", to: "#666C73", ink: LIGHT_INK },
  GRAY: { from: "#9CA2A9", to: "#666C73", ink: LIGHT_INK },
  GUMUS: { from: "#CDD2D8", to: "#98A0A9", ink: DARK_INK },
  SILVER: { from: "#CDD2D8", to: "#98A0A9", ink: DARK_INK },
  KIRMIZI: { from: "#BE3B2E", to: "#78201A", ink: LIGHT_INK },
  RED: { from: "#BE3B2E", to: "#78201A", ink: LIGHT_INK },
  MAVI: { from: "#35719F", to: "#1B3F64", ink: LIGHT_INK },
  BLUE: { from: "#35719F", to: "#1B3F64", ink: LIGHT_INK },
  LACIVERT: { from: "#2A3C61", to: "#141E33", ink: LIGHT_INK },
  NAVY: { from: "#2A3C61", to: "#141E33", ink: LIGHT_INK },
  YESIL: { from: "#417A5B", to: "#1F4533", ink: LIGHT_INK },
  GREEN: { from: "#417A5B", to: "#1F4533", ink: LIGHT_INK },
  SARI: { from: "#E0B646", to: "#A97F1B", ink: DARK_INK },
  YELLOW: { from: "#E0B646", to: "#A97F1B", ink: DARK_INK },
  TURUNCU: { from: "#D2792F", to: "#8F4C13", ink: LIGHT_INK },
  ORANGE: { from: "#D2792F", to: "#8F4C13", ink: LIGHT_INK },
  KAHVERENGI: { from: "#7C6049", to: "#483424", ink: LIGHT_INK },
  BROWN: { from: "#7C6049", to: "#483424", ink: LIGHT_INK },
  BORDO: { from: "#7C3341", to: "#471822", ink: LIGHT_INK },
  MAROON: { from: "#7C3341", to: "#471822", ink: LIGHT_INK },
  MOR: { from: "#6C4E85", to: "#3F2C53", ink: LIGHT_INK },
  PURPLE: { from: "#6C4E85", to: "#3F2C53", ink: LIGHT_INK },
  PEMBE: { from: "#D293A6", to: "#A25E76", ink: DARK_INK },
  PINK: { from: "#D293A6", to: "#A25E76", ink: DARK_INK },
  ALTIN: { from: "#C9A63C", to: "#8B6A14", ink: DARK_INK },
  GOLD: { from: "#C9A63C", to: "#8B6A14", ink: DARK_INK },
  BEJ: { from: "#DECDB4", to: "#B5A186", ink: DARK_INK },
  BEIGE: { from: "#DECDB4", to: "#B5A186", ink: DARK_INK },
};

/**
 * Used when the vehicle carries no colour. Graphite/steel rather than a second
 * colour wheel: an unrecorded colour must not look like a recorded one, but it
 * still has to distinguish two vehicles side by side.
 */
const NEUTRAL_TINTS: VehicleTint[] = [
  { from: "#5C6470", to: "#333943", ink: LIGHT_INK },
  { from: "#4E5A63", to: "#2B333A", ink: LIGHT_INK },
  { from: "#6A6259", to: "#3B3630", ink: LIGHT_INK },
  { from: "#57616B", to: "#2F3740", ink: LIGHT_INK },
  { from: "#63606D", to: "#37353F", ink: LIGHT_INK },
  { from: "#4F5F5C", to: "#2B3634", ink: LIGHT_INK },
];

/**
 * Turkish-aware colour normalization. Mirrors the intent of `norm()` in the API
 * (apps/api/src/ocr/catalog.ts) — dotted/dotless İ and the rest fold to ASCII —
 * so "Kırmızı", "KIRMIZI" and "kirmizi" are one key.
 */
function normColor(s: string): string {
  return s
    .replace(/İ/g, "I").replace(/ı/g, "I")
    .replace(/Ş/g, "S").replace(/ş/g, "S")
    .replace(/Ğ/g, "G").replace(/ğ/g, "G")
    .replace(/Ü/g, "U").replace(/ü/g, "U")
    .replace(/Ö/g, "O").replace(/ö/g, "O")
    .replace(/Ç/g, "C").replace(/ç/g, "C")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Longest keys first, so "KAHVERENGI" is tested before any shorter prefix. */
const COLOR_KEYS = Object.keys(COLOR_TINTS).sort((a, b) => b.length - a.length);

/** FNV-1a. Small, stable across reloads and platforms — the point is that a
 *  vehicle looks the same today as it did yesterday. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * The identity tint for a vehicle. Colour wins when we have one; otherwise a
 * stable hash of the id (falling back to make/model/nickname for records that
 * have no id yet, e.g. a form preview).
 */
export function vehicleTint(v: {
  id?: string | null;
  color?: string | null;
  make?: string | null;
  model?: string | null;
  nickname?: string | null;
}): VehicleTint {
  const c = normColor(v.color ?? "");
  if (c) {
    const exact = COLOR_TINTS[c];
    if (exact) return exact;
    // Real records say "Beyaz Metalik", "GRİ METALİK", "Buz Mavisi" — match on
    // the recorded colour CONTAINING a known one rather than equalling it.
    const key = COLOR_KEYS.find((k) => c.includes(k));
    if (key) return COLOR_TINTS[key]!;
  }
  const seed = v.id || `${v.make ?? ""}${v.model ?? ""}${v.nickname ?? ""}`;
  return NEUTRAL_TINTS[hash(seed) % NEUTRAL_TINTS.length]!;
}

/** The CSS gradient for a tint. One place, so every surface renders it identically. */
export function tintGradient(t: VehicleTint): string {
  return `linear-gradient(135deg, ${t.from} 0%, ${t.to} 100%)`;
}

/**
 * The URL for a vehicle photo at the size a surface actually needs.
 *
 * `photoUrl` from the API is the full 1280×960 master with a `?v=` cache-buster
 * (apps/api/src/routes/bikes.ts). A 44px list thumbnail does not need 200 KB of
 * it, and a garage of five was downloading a megabyte to draw five squares — so
 * the API also stores a 320×240 derivative, requested with `size=thumb`. The
 * parameter is appended rather than replacing the query because `?v=` must
 * survive: it is what makes a replaced photo appear immediately.
 */
export function vehiclePhotoSrc(
  photoUrl: string | null | undefined,
  apiBase: string,
  size: "thumb" | "full" = "full",
): string | null {
  if (!photoUrl) return null;
  const sep = photoUrl.includes("?") ? "&" : "?";
  return `${apiBase}${photoUrl}${size === "thumb" ? `${sep}size=thumb` : ""}`;
}
