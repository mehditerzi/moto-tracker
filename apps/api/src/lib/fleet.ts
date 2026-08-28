import { addMonths, differenceInCalendarDays, format, parseISO } from "date-fns";
import type { FleetStatus } from "@mototracker/shared";
import { config } from "../config.js";

/**
 * The small shared vocabulary the fleet routes speak: what "today" is, how a due
 * date becomes a status, and how a plate is compared.
 *
 * It lives here rather than in a route because three endpoints (triage,
 * inventory, vehicle detail) must agree on all three answers — a board that
 * calls something overdue and a table that calls the same thing "soon" is worse
 * than either being wrong on its own.
 */

/**
 * Today as a calendar day, in the timezone the business actually works in.
 *
 * Not `toISOString().slice(0,10)`: that is UTC, and for three hours every
 * evening in Istanbul it reports yesterday — which on this screen means a
 * document that expires today is shown as expiring tomorrow. Same source of
 * truth as the notification cron (notify/cron.ts).
 */
export function fleetToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: config.CRON_TIMEZONE });
}

/**
 * The consumer app's thresholds, unchanged (web/src/lib/datedItems.ts): a fleet
 * manager who also uses the consumer app must not have to relearn the colours.
 */
export function fleetStatusFor(daysRemaining: number | null): FleetStatus {
  if (daysRemaining === null) return "unset";
  if (daysRemaining < 0) return "expired";
  if (daysRemaining <= 7) return "danger";
  if (daysRemaining <= 30) return "soon";
  return "ok";
}

/** Signed days from `today` to `dueOn`; negative means already overdue. */
export function daysUntil(dueOn: string, today: string): number {
  return differenceInCalendarDays(parseISO(dueOn), parseISO(today));
}

/**
 * When a maintenance interval next comes due, by DATE. Mirrors
 * notify/computeDueNotifications.ts exactly — a service the notifier warns about
 * must be the same service the board shows, or one of them is lying.
 *
 * Km-based intervals have no due date at all; `kmRemaining` below carries them.
 */
export function maintenanceDueOn(item: {
  last_done_on: string | null;
  interval_months: number | null;
}): string | null {
  if (!item.last_done_on || !item.interval_months) return null;
  return format(addMonths(parseISO(item.last_done_on), item.interval_months), "yyyy-MM-dd");
}

/** Km left before a km-based interval is due; null when it cannot be computed. */
export function maintenanceKmRemaining(
  item: { last_done_km: number | null; interval_km: number | null },
  currentKm: number | null,
): number | null {
  if (item.last_done_km === null || !item.interval_km || currentKm === null) return null;
  return item.last_done_km + item.interval_km - currentKm;
}

// ─── plates ───────────────────────────────────────────────────────────────────

/**
 * A plate reduced to what it IS rather than how it was typed: `34 ABC 123`,
 * `34ABC123` and `34-abc-123` all become `34ABC123`.
 *
 * Turkish letters are folded the same way `ocr/catalog.ts`'s `norm()` folds
 * them. Plates are ASCII by law, but the field is free text and an operator
 * pasting from a document occasionally brings a `İ` along.
 */
export function normPlate(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .replace(/İ/g, "I")
    .replace(/ı/g, "I")
    .replace(/Ş/g, "S")
    .replace(/ş/g, "S")
    .replace(/Ğ/g, "G")
    .replace(/ğ/g, "G")
    .replace(/Ü/g, "U")
    .replace(/ü/g, "U")
    .replace(/Ö/g, "O")
    .replace(/ö/g, "O")
    .replace(/Ç/g, "C")
    .replace(/ç/g, "C")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Case- and diacritic-insensitive "contains", for free-text search over make,
 * model and nickname. SQLite's UPPER() is ASCII-only, so `Şahin` would not match
 * `şahin` in SQL; doing the fold in one place in JS keeps search behaving the
 * same for a Turkish nickname as for an English one.
 */
export function foldedIncludes(haystack: string | null | undefined, needleFolded: string): boolean {
  if (!haystack || !needleFolded) return false;
  return fold(haystack).includes(needleFolded);
}

/** Uppercase with Turkish letters folded onto ASCII; punctuation preserved. */
export function fold(s: string): string {
  return s
    .replace(/İ/g, "I")
    .replace(/ı/g, "I")
    .replace(/Ş/g, "S")
    .replace(/ş/g, "S")
    .replace(/Ğ/g, "G")
    .replace(/ğ/g, "G")
    .replace(/Ü/g, "U")
    .replace(/ü/g, "U")
    .replace(/Ö/g, "O")
    .replace(/ö/g, "O")
    .replace(/Ç/g, "C")
    .replace(/ç/g, "C")
    .toUpperCase();
}
