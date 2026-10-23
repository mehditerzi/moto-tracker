import i18n from "@/lib/i18n";

function localeFor(lang?: string): string {
  return (lang ?? i18n.language ?? "tr").toLowerCase().startsWith("en") ? "en-GB" : "tr-TR";
}

// Locale-aware date formatting. TR → dd.MM.yyyy; EN → en-GB style (dd/MM/yyyy).
// Falls back to the raw string if the input can't be parsed, so a bad value is
// never rendered as "Invalid Date".
export function formatDate(iso: string, lang?: string): string {
  // A bare YYYY-MM-DD is a calendar date, not an instant: `new Date()` would read
  // it as UTC midnight and show the previous day west of Greenwich.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) as [string, string, string, string] | null;
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(localeFor(lang), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/** A plain number in the UI language: 1.690 / 2,13 in Turkish, 1,690 / 2.13 in English. */
export function formatNumber(n: number, fractionDigits = 0, lang?: string): string {
  return new Intl.NumberFormat(localeFor(lang), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(n);
}

/** Turkish lira, always with the ₺ prefix the rest of the app uses. */
export function formatMoney(n: number, fractionDigits = 0, lang?: string): string {
  return `₺${formatNumber(n, fractionDigits, lang)}`;
}

/** Today in the device's own timezone, as YYYY-MM-DD. `toISOString()` is UTC,
 *  which puts users east of Greenwich on tomorrow's date for part of every evening. */
export function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
