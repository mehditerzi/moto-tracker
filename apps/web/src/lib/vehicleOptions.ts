/** Common Turkish vehicle colors, for the color picker. Free text still allowed. */
export const COLOR_OPTIONS = [
  "Beyaz", "Siyah", "Gri", "Gümüş", "Kırmızı", "Mavi", "Lacivert", "Yeşil",
  "Sarı", "Turuncu", "Kahverengi", "Bordo", "Mor", "Pembe", "Altın", "Bej",
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
