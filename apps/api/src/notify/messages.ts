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

// ─── sharing activity ─────────────────────────────────────────────────────────
//
// Event-driven copy (notify/events.ts). Every one of these is a WHOLE SENTENCE
// per language with the variable in the place that language puts it — never a
// fragment joined at runtime. Turkish is agglutinative and verb-final: "Someone
// is asking for access to Corolla" is "Corolla için birisi erişim istiyor",
// where the vehicle leads and the verb ends. A shared skeleton with swapped
// nouns cannot express both, and the version that tries reads as machine
// translation in at least one of the two.
//
// WHAT THESE STRINGS MAY CONTAIN is as deliberate as how they are worded. A
// push notification renders on a locked screen, in front of whoever is standing
// there, and the sharing design is explicit that a duplicate check never
// discloses an identity in either direction:
//
//   - To the HOLDER we name their own vehicle (they already know it) and never
//     the requester's name, email or note. Those are on the decision screen,
//     behind their passcode, where they belong.
//   - To the REQUESTER we echo only the identifier THEY typed. Not the
//     vehicle's nickname, not its plate, not a word about who holds it — not
//     even after a refusal, which is precisely when a leak would be most
//     tempting and most harmful.
//   - To an INVITEE we name neither the garage nor its vehicles nor the person
//     inviting them, because the address may simply have been mistyped.

export interface Message {
  title: string;
  body: string;
}

/** Someone asked for access to a vehicle the recipient holds. */
export function claimAccessMessage(lang: Lang, vehicle: string): Message {
  return lang === "en"
    ? { title: "Access request", body: `Someone is asking for access to ${vehicle}.` }
    : { title: "Erişim isteği", body: `${vehicle} için birisi erişim istiyor.` };
}

/**
 * Someone says they bought a vehicle the recipient holds. The one message in
 * the app that starts a clock, so the deadline is IN the sentence: silence for
 * `days` days lets the claimant open a competing record of the vehicle, and a
 * holder who was told only "somebody claimed your car" has not been told the
 * part that matters.
 */
export function claimPurchaseMessage(lang: Lang, vehicle: string, days: number): Message {
  return lang === "en"
    ? {
        title: "Ownership claim",
        body:
          days === 1
            ? `Someone says they bought ${vehicle}. Answer within 1 day.`
            : `Someone says they bought ${vehicle}. Answer within ${days} days.`,
      }
    : {
        title: "Sahiplik talebi",
        body: `Birisi ${vehicle} aracını satın aldığını bildirdi. ${days} gün içinde yanıtlayın.`,
      };
}

/** The recipient's own request was decided. `hint` is the identifier they typed. */
export function claimDecidedMessage(
  lang: Lang,
  decision: "approved" | "declined",
  hint: string,
): Message {
  if (lang === "en") {
    return decision === "approved"
      ? { title: "Request approved", body: `Your request about ${hint} was approved.` }
      : { title: "Request declined", body: `Your request about ${hint} was declined.` };
  }
  return decision === "approved"
    ? { title: "İsteğiniz onaylandı", body: `${hint} için gönderdiğiniz istek onaylandı.` }
    : { title: "İsteğiniz reddedildi", body: `${hint} için gönderdiğiniz istek reddedildi.` };
}

/**
 * The invitation email.
 *
 * Deliberately contentless. It names no garage, no vehicle and no inviter,
 * because the only thing we actually know about this address is that somebody
 * typed it — and a transposed character sends the whole thing to a stranger.
 * Everything a real invitee needs to decide (the garage's name, how many
 * vehicles are in it, and exactly what the offered role will let them see) is
 * behind the link, on a screen that requires signing in as this address. That
 * is not an inconvenience we tolerated; it is where the consent conversation
 * belongs.
 */
export function inviteEmailBody(
  lang: Lang,
  url: string,
  ttlDays: number,
): { subject: string; text: string; html: string } {
  if (lang === "en") {
    const subject = "Garajım — you have been invited to a shared garage";
    return {
      subject,
      text: [
        "Somebody has invited you to a shared garage on Garajım.",
        "",
        `Open the invitation: ${url}`,
        "",
        `You will need a Garajım account with this email address to accept it, and the link works for ${ttlDays} days.`,
        "",
        "If you were not expecting this, ignore this email — nothing has been shared with you and no account has been created.",
      ].join("\n"),
      html:
        `<p>Somebody has invited you to a shared garage on Garaj&#305;m.</p>` +
        `<p><a href="${url}">Open the invitation</a></p>` +
        `<p>You will need a Garaj&#305;m account with this email address to accept it, and the link works for ${ttlDays} days.</p>` +
        `<p>If you were not expecting this, ignore this email &mdash; nothing has been shared with you and no account has been created.</p>`,
    };
  }
  const subject = "Garajım — paylaşılan bir garaja davet edildiniz";
  return {
    subject,
    text: [
      "Birisi sizi Garajım'da paylaşılan bir garaja davet etti.",
      "",
      `Daveti açın: ${url}`,
      "",
      `Kabul etmek için bu e-posta adresiyle bir Garajım hesabınızın olması gerekir; bağlantı ${ttlDays} gün geçerlidir.`,
      "",
      "Böyle bir davet beklemiyorsanız bu e-postayı görmezden gelin — sizinle hiçbir şey paylaşılmadı ve hesap oluşturulmadı.",
    ].join("\n"),
    html:
      `<p>Birisi sizi Garaj&#305;m'da payla&#351;&#305;lan bir garaja davet etti.</p>` +
      `<p><a href="${url}">Daveti a&ccedil;</a></p>` +
      `<p>Kabul etmek i&ccedil;in bu e-posta adresiyle bir Garaj&#305;m hesab&#305;n&#305;z&#305;n olmas&#305; gerekir; ba&#287;lant&#305; ${ttlDays} g&uuml;n ge&ccedil;erlidir.</p>` +
      `<p>B&ouml;yle bir davet beklemiyorsan&#305;z bu e-postay&#305; g&ouml;rmezden gelin &mdash; sizinle hi&ccedil;bir &#351;ey payla&#351;&#305;lmad&#305; ve hesap olu&#351;turulmad&#305;.</p>`,
  };
}
