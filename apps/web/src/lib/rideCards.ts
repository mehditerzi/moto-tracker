import type { TFunction } from "i18next";
import type { Bike, RideEvent, Trip } from "@mototracker/shared";
import { decodePolyline } from "@/lib/polyline";
import { formatNumber } from "@/lib/format";
import type { CardData } from "@/lib/shareCard";

/** Builders that turn app data into share-card data, in the user's language. */

export function tripMinutes(trip: Pick<Trip, "startedAt" | "endedAt">): number {
  return Math.max(0, Math.round((Date.parse(trip.endedAt) - Date.parse(trip.startedAt)) / 60_000));
}

export function durationText(min: number, t: TFunction): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? t("map.durationHm", { h, m }) : t("map.durationM", { m });
}

export function avgSpeed(km: number, min: number): number | null {
  return min >= 5 ? km / (min / 60) : null;
}

export function rideWhen(iso: string, lang: string): string {
  return new Intl.DateTimeFormat(lang, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function tripCard(trip: Trip, bike: Bike | undefined, t: TFunction, lang: string): CardData {
  const min = tripMinutes(trip);
  const speed = avgSpeed(trip.distanceKm, min);
  const date = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(
    new Date(trip.startedAt),
  );
  let route: [number, number][] | null = null;
  try {
    route = trip.route ? decodePolyline(trip.route) : null;
  } catch {
    route = null;
  }
  return {
    kind: "trip",
    eyebrow: t("shareCard.tripEyebrow"),
    title: bike?.nickname ?? t("trips.unknownVehicle"),
    date,
    hero: { label: t("shareCard.distance"), value: formatNumber(trip.distanceKm, 1, lang), unit: "km" },
    stats: [
      { label: t("shareCard.time"), value: durationText(min, t) },
      ...(speed ? [{ label: t("shareCard.avgSpeed"), value: formatNumber(speed, 0, lang), unit: t("shareCard.kmh") }] : []),
    ],
    route,
    vehicle: bike ?? null,
  };
}

/** A month (or any span) of riding, summed from trips. */
export function summaryCard(
  trips: Trip[],
  opts: { title: string; eyebrow: string; vehicle: Bike | null; bars?: { label: string; value: number }[] },
  t: TFunction,
  lang: string,
): CardData {
  const km = trips.reduce((s, x) => s + x.distanceKm, 0);
  const min = trips.reduce((s, x) => s + tripMinutes(x), 0);
  const longest = trips.reduce((m, x) => Math.max(m, x.distanceKm), 0);
  return {
    kind: "summary",
    eyebrow: opts.eyebrow,
    title: opts.title,
    hero: { label: t("shareCard.distance"), value: formatNumber(km, 0, lang), unit: "km" },
    stats: [
      { label: t("shareCard.rides"), value: String(trips.length) },
      { label: t("shareCard.time"), value: durationText(min, t) },
      { label: t("shareCard.longest"), value: formatNumber(longest, 0, lang), unit: "km" },
      { label: t("shareCard.avgRide"), value: formatNumber(trips.length ? km / trips.length : 0, 0, lang), unit: "km" },
    ],
    vehicle: opts.vehicle,
    bars: opts.bars,
  };
}

export function rideEventCard(ev: RideEvent, bike: Bike | null, t: TFunction, lang: string): CardData {
  return {
    kind: "ride",
    eyebrow: t("rides.cardEyebrow"),
    title: ev.title,
    lines: [
      { icon: "when", text: rideWhen(ev.startsAt, lang) },
      { icon: "meet", text: ev.meet.name },
      ...(ev.destination ? [{ icon: "dest" as const, text: ev.destination.name }] : []),
      { icon: "people", text: t("rides.goingCount", { count: ev.goingCount }) },
    ],
    code: ev.code,
    cta: t("rides.cardCta"),
    vehicle: bike,
  };
}

/** Kilometres per week for the last `weeks` weeks, oldest first. */
export function weeklyBars(trips: Trip[], weeks: number, lang: string): { label: string; value: number }[] {
  const now = new Date();
  const startOfWeek = (d: Date) => {
    const x = new Date(d);
    const day = (x.getDay() + 6) % 7; // Monday = 0
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - day);
    return x;
  };
  const current = startOfWeek(now).getTime();
  const out = Array.from({ length: weeks }, (_, i) => {
    const start = new Date(current - (weeks - 1 - i) * 7 * 86_400_000);
    return { start: start.getTime(), label: new Intl.DateTimeFormat(lang, { day: "numeric", month: "short" }).format(start), value: 0 };
  });
  for (const tr of trips) {
    const t0 = startOfWeek(new Date(tr.startedAt)).getTime();
    const b = out.find((o) => o.start === t0);
    if (b) b.value += tr.distanceKm;
  }
  return out.map(({ label, value }) => ({ label, value }));
}
