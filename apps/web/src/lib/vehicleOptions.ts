/** Common Turkish vehicle colors, for the color picker. Free text still allowed. */
export const COLOR_OPTIONS = [
  "Beyaz", "Siyah", "Gri", "Gümüş", "Kırmızı", "Mavi", "Lacivert", "Yeşil",
  "Sarı", "Turuncu", "Kahverengi", "Bordo", "Mor", "Pembe", "Altın", "Bej",
];

/** Common Turkish fuel types, for the fuel picker. Free text still allowed. */
export const FUEL_OPTIONS = [
  "Benzin", "Dizel", "LPG", "Benzin + LPG", "Elektrik", "Hibrit", "Hidrojen",
];

/** Turkish insurance providers, for the dated-item provider picker. */
export const PROVIDER_OPTIONS = [
  "Allianz", "Anadolu Sigorta", "Aksigorta", "Axa Sigorta", "HDI Sigorta",
  "Mapfre Sigorta", "Sompo Sigorta", "Quick Sigorta", "Ray Sigorta",
  "Türkiye Sigorta", "Unico Sigorta", "Zurich Sigorta", "Doğa Sigorta",
  "Neova Sigorta", "Gulf Sigorta", "Groupama", "Ankara Sigorta",
  "Bereket Sigorta", "Koru Sigorta", "Türk Nippon Sigorta", "Magdeburger Sigorta",
];

/** Years from the current year back to 1980, newest first. */
export function yearOptions(): string[] {
  const now = new Date().getFullYear();
  const out: string[] = [];
  for (let y = now + 1; y >= 1980; y--) out.push(String(y));
  return out;
}

/**
 * One spelling per fuel. Values arrive from OCR ("BENZİNLİ"), from older model
 * output ("gasoline") and from people; the picker should show the option they
 * mean, not the raw string.
 */
export function normalizeFuel(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = raw
    .toLocaleUpperCase("tr")
    .replace(/İ/g, "I")
    .replace(/Ş/g, "S")
    .replace(/Ü/g, "U")
    .replace(/Ö/g, "O")
    .replace(/Ç/g, "C")
    .replace(/Ğ/g, "G");
  const lpg = /LPG/.test(s);
  if (/BENZ|GASOL|PETROL/.test(s)) return lpg ? "Benzin + LPG" : "Benzin";
  if (/DIZ|DIES|MOTORIN/.test(s)) return "Dizel";
  if (lpg) return "LPG";
  if (/ELEK|ELECT|EV\b/.test(s)) return "Elektrik";
  if (/HIB|HYB/.test(s)) return "Hibrit";
  if (/HIDRO|HYDRO/.test(s)) return "Hidrojen";
  return raw;
}
