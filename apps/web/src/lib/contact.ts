/**
 * Turning what people type into links the phone can act on. Turkish numbers
 * arrive in every shape — "0532 123 45 67", "+90 (532) 123-4567", "5321234567",
 * "444 0 123" — and each link scheme wants its own.
 */

/** Digits and a leading +, nothing else — what `tel:` wants. */
export function telHref(phone: string): string {
  const cleaned = phone.trim().replace(/[^\d+]/g, "");
  return `tel:${cleaned}`;
}

/**
 * International digits without the +, as wa.me wants them. Assumes Turkey for a
 * national number (leading 0, or a bare 10-digit mobile starting with 5). Short
 * service numbers (444 x xxx) have no WhatsApp and return null.
 */
export function whatsappNumber(phone: string): string | null {
  let d = phone.replace(/\D/g, "");
  if (phone.trim().startsWith("+")) return d.length >= 10 ? d : null;
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = `90${d.slice(1)}`;
  else if (d.length === 10 && d.startsWith("5")) d = `90${d}`;
  return d.length >= 11 ? d : null;
}

export function whatsappHref(phone: string, text?: string): string | null {
  const n = whatsappNumber(phone);
  if (!n) return null;
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** Apple Maps (opens the Maps app on iOS, the web map elsewhere). */
export function mapsHref(opts: { lat?: number | null; lng?: number | null; query?: string | null; directions?: boolean }): string {
  const p = new URLSearchParams();
  const hasPoint = opts.lat != null && opts.lng != null;
  if (opts.directions) {
    if (hasPoint) p.set("daddr", `${opts.lat},${opts.lng}`);
    else if (opts.query) p.set("daddr", opts.query);
  } else {
    if (opts.query) p.set("q", opts.query);
    if (hasPoint) p.set("ll", `${opts.lat},${opts.lng}`);
  }
  return `https://maps.apple.com/?${p.toString()}`;
}

/** A Google/Apple-neutral link someone without the app can open. */
export function locationShareUrl(lat: number, lng: number): string {
  return `https://maps.apple.com/?ll=${lat.toFixed(6)},${lng.toFixed(6)}&q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

export function smsHref(phones: string[], body: string): string {
  // iOS separates recipients with commas and wants `&body=` after the address.
  const to = phones.map((p) => p.replace(/[^\d+]/g, "")).join(",");
  return `sms:${to}&body=${encodeURIComponent(body)}`;
}
