/**
 * Server-side copy for push notifications, in the two languages the app ships
 * in. Deliberately a small self-contained map rather than an import of the web
 * app's locale JSON: the API is its own package and must not depend on the
 * React build's file layout. Keep the wording in sync with apps/web
 * `items.*` / `maintenance.kinds.*` when either side changes.
 */

export type Lang = "tr" | "en";

/** The language we fall back to when a user has no profile row (TR market). */
export const DEFAULT_LANG: Lang = "tr";

export function asLang(value: unknown): Lang {
  return value === "en" ? "en" : "tr";
}

/** dated_item.type + the synthetic "maintenance" bucket. */
const TYPE_LABEL: Record<Lang, Record<string, string>> = {
  tr: {
    sigorta: "Sigorta",
    kasko: "Kasko",
    muayene: "Muayene",
    maintenance: "Bakım",
    mtv: "MTV",
  },
  en: {
    sigorta: "Insurance",
    kasko: "Kasko",
    muayene: "Inspection",
    maintenance: "Maintenance",
    mtv: "Vehicle tax",
  },
};

/** maintenance_item.kind. 'custom' items carry their own user-written label. */
const MAINT_LABEL: Record<Lang, Record<string, string>> = {
  tr: {
    engine_oil: "Motor yağı",
    brakes: "Fren",
    tires: "Lastik",
    battery: "Akü",
    coolant: "Soğutma",
    air_filter: "Hava filtresi",
    chain: "Zincir",
    custom: "Bakım",
  },
  en: {
    engine_oil: "Engine oil",
    brakes: "Brakes",
    tires: "Tires",
    battery: "Battery",
    coolant: "Coolant",
    air_filter: "Air filter",
    chain: "Chain",
    custom: "Maintenance",
  },
};

const FALLBACK_TITLE: Record<Lang, string> = { tr: "Bildirim", en: "Reminder" };

/**
 * Full sentence per language — not a concatenation of fragments. Turkish puts
 * the time phrase before the verb ("Sigorta 3 gün sonra bitiyor") while English
 * puts it after ("Insurance expires in 3 days"), so each language owns its own
 * template. English also needs singular/plural for the day count.
 */
function expiryTitle(lang: Lang, label: string, days: number): string {
  if (lang === "en") {
    if (days === 0) return `${label} expires today`;
    return days === 1 ? `${label} expires in 1 day` : `${label} expires in ${days} days`;
  }
  return days === 0 ? `${label} bugün bitiyor` : `${label} ${days} gün sonra bitiyor`;
}

export function typeLabel(lang: Lang, itemType: string): string {
  return TYPE_LABEL[lang][itemType] ?? FALLBACK_TITLE[lang];
}

/** Known kinds are translated; a custom item keeps the label the user typed. */
export function maintenanceLabel(lang: Lang, kind: string | null, customLabel: string | null): string {
  const generic = MAINT_LABEL[lang].custom ?? FALLBACK_TITLE[lang];
  if (kind === "custom") return customLabel?.trim() || generic;
  return (kind ? MAINT_LABEL[lang][kind] : null) || generic;
}

export function notificationTitle(lang: Lang, label: string, leadDays: number): string {
  return expiryTitle(lang, label, leadDays);
}
