/** "3 dk önce", "dün", "12 Eki" — short and local. */
export function relTime(iso: string, lang: string): string {
  const then = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  const s = Math.round((Date.now() - then) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "short" });
  if (s < 60) return rtf.format(0, "second");
  if (s < 3600) return rtf.format(-Math.floor(s / 60), "minute");
  if (s < 86_400) return rtf.format(-Math.floor(s / 3600), "hour");
  if (s < 7 * 86_400) return rtf.format(-Math.floor(s / 86_400), "day");
  return new Intl.DateTimeFormat(lang, { day: "numeric", month: "short" }).format(new Date(then));
}
