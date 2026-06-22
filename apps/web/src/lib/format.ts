// Locale-aware date formatting. TR → dd.MM.yyyy; EN → en-GB style (dd/MM/yyyy).
// Falls back to the raw string if the input can't be parsed, so a bad value is
// never rendered as "Invalid Date".
export function formatDate(iso: string, lang: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const locale = lang.toLowerCase().startsWith("tr") ? "tr-TR" : "en-GB";
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}
