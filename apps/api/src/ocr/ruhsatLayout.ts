import { foldTr } from "./backstop.js";
import { levenshtein, matchMake } from "./catalog.js";
import { normalizeDate } from "./parser.js";
import { isVin } from "./validators.js";

/**
 * Read a Turkish registration card (ruhsat) without a language model.
 *
 * The card is a form: every field is a printed label — "(D.1) MARKASI",
 * "(E) ŞASE NO" — with its value directly under it or on the same row. Given
 * the OCR lines WITH their positions (Apple Vision on the phone or on the host
 * returns a box for every line), a field is the nearest line under or beside
 * its label that has the right shape for that field. That is a few
 * milliseconds of geometry instead of seconds of a model guessing, and it does
 * not hallucinate: a field it cannot see stays null.
 *
 * Without positions (plain OCR text, e.g. glm-ocr), the same labels are found
 * in reading order and the value is the next line that fits.
 *
 * Labels are matched loosely on purpose. OCR reads "(B) İLK TESCİL TARİHİ" as
 * "(B)TLK TISCE LR" and "ŞASE NO" as "SASENO"; an exact match would miss half
 * the cards. Each field therefore has a code ("D.1") and keywords, compared
 * after folding Turkish letters and with an edit-distance allowance.
 */

/** One OCR line in top-left-origin unit coordinates (0..1 of the image). */
export interface OcrLine {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RuhsatFields {
  plate: string | null;
  firstRegistrationDate: string | null;
  make: string | null;
  model: string | null;
  vehicleTypeHint: string | null;
  year: number | null;
  color: string | null;
  engineNo: string | null;
  chassisNo: string | null;
  cylinderCc: number | null;
  fuelType: string | null;
  muayeneExpiresOn: string | null;
  /** How many of the card's labels were recognised — "is this a ruhsat?" */
  labelsFound: number;
}

type FieldKey =
  | "plate"
  | "firstReg"
  | "make"
  | "type"
  | "trade"
  | "year"
  | "kind"
  | "color"
  | "engine"
  | "chassis"
  | "cc"
  | "fuel"
  | "inspection";

interface FieldSpec {
  key: FieldKey;
  /** Folded, space-free keywords; any one is enough. */
  words: string[];
  /** Code letters as printed, e.g. ["D1"]. */
  codes: string[];
}

const FIELDS: FieldSpec[] = [
  { key: "plate", words: ["PLAKA"], codes: ["A"] },
  { key: "firstReg", words: ["ILKTESCIL"], codes: ["B"] },
  { key: "make", words: ["MARKASI", "MARKA"], codes: ["D1"] },
  { key: "type", words: ["TIPI"], codes: ["D2"] },
  { key: "trade", words: ["TICARIADI"], codes: ["D3"] },
  { key: "year", words: ["MODELYILI", "MODELYIL"], codes: ["D4"] },
  { key: "kind", words: ["CINSI"], codes: ["D5"] },
  { key: "color", words: ["RENGI", "RENK"], codes: ["R"] },
  { key: "engine", words: ["MOTORNO"], codes: ["P5"] },
  { key: "chassis", words: ["SASENO", "SASINO", "SASE", "SASI"], codes: ["E"] },
  { key: "cc", words: ["SILINDIRHACMI", "SILINDIR"], codes: ["P1"] },
  { key: "fuel", words: ["YAKITCINSI", "YAKIT"], codes: ["P3"] },
  // The free-text (Z.2) box. On a ruhsat it carries exactly one thing: the
  // inspection note ("muayene geçerlilik tarihi: 19-08-2026").
  { key: "inspection", words: ["DIGERBILGILER", "BILGILER"], codes: ["Z2"] },
];

// Words that only ever appear on labels. A line containing one is never a value.
const LABEL_NOISE = [
  "NOTER", "AGIRLIG", "KOLTUK", "YOLCU", "TESCILSIRA", "TESCILTARIHI", "VERILDIGI", "MOTORGUCU", "TICAR",
  "ONAYNO", "KULLANIMAMACI", "HAKVE", "MENFAAT", "BILGILER", "MUHUR", "ROMORK", "KATAR",
  "UNVAN", "ONVAN", "SAHIBI", "ADRES", "KIMLIK", "SICIL",
];

/** Every code a ruhsat prints, ours or not — a known foreign code vetoes a fuzzy keyword. */
const ALL_CODES = new Set([
  "A", "B", "C", "D1", "D2", "D3", "D4", "D5", "E", "F1", "G", "G1", "G2", "I", "J", "K", "P1", "P2", "P3", "P5",
  "Q", "R", "S1", "S2", "Y1", "Y2", "Y3", "Y4", "Z1", "Z2", "Z3", "Z4",
]);

// Cyrillic letters Vision's multilingual model sometimes emits for Latin ones.
const HOMOGLYPH: Record<string, string> = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y",
  І: "I", Ј: "J", Ѕ: "S", И: "N", Л: "L", П: "N", Г: "G", Д: "D", З: "3", Б: "6", Я: "R",
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", к: "k", м: "m", т: "t", н: "h",
};

export function deHomoglyph(s: string): string {
  return s.replace(/[Ѐ-ӿ]/g, (c) => HOMOGLYPH[c] ?? c);
}

/** Folded, Latin-only, upper — the form every comparison below runs on. */
function F(s: string): string {
  return foldTr(deHomoglyph(s));
}

/** Folded and stripped to letters/digits. */
function compact(s: string): string {
  return F(s).replace(/[^A-Z0-9]/g, "");
}

/** The "(D.1)"-style code at the start of a label, normalised to "D1". */
function codeOf(s: string): string | null {
  const m = /^\s*[(\[{]?\s*([A-Z])\s*[.,:]?\s*([0-9IL]{0,1})\s*[)\]}]/.exec(F(s));
  if (!m) return null;
  const n = m[2] === "I" || m[2] === "L" ? "1" : m[2];
  return `${m[1]}${n ?? ""}`;
}

/** Does `hay` contain something within `tol` edits of `word`? */
function fuzzyContains(hay: string, word: string, tol: number): boolean {
  if (hay.includes(word)) return true;
  if (tol === 0 || hay.length < word.length - tol) return false;
  for (let i = 0; i + word.length - tol <= hay.length; i++) {
    for (const len of [word.length - 1, word.length, word.length + 1]) {
      if (len <= 0 || i + len > hay.length) continue;
      if (levenshtein(hay.slice(i, i + len), word, tol) <= tol) return true;
    }
  }
  return false;
}

interface Label {
  key: FieldKey;
  line: number;
  /** The rest of the label line after the label itself, e.g. "MOTOSIKLET". */
  inline: string;
}

export function detectLabel(text: string): { key: FieldKey; inline: string } | null {
  const c = compact(text);
  if (!c) return null;
  const code = codeOf(text);
  // Code + keyword agreeing is the strongest signal; a keyword alone (with a
  // small edit allowance) is next; a bare code is accepted only when the line
  // is short enough to be nothing but a label.
  // The owner's block ("TİCARİ ÜNVANI", "ADRESİ") reuses label words; it never
  // carries a vehicle field.
  if (/UNVAN|ONVAN|SAHIBI|ADRES/.test(c)) return null;
  let best: { key: FieldKey; score: number; word: string } | null = null;
  for (const f of FIELDS) {
    const codeAgrees = !!code && f.codes.includes(code);
    // A code that belongs to a different printed field ("(S.2) AYAKTA YOLCU")
    // overrules a lookalike word ("AYAKTA" ≈ "YAKIT").
    const codeConflicts = !!code && !codeAgrees && ALL_CODES.has(code);
    for (const w of f.words) {
      const exact = c.includes(w);
      // Short words must match exactly: one edit away from "MARKA" is "MARAS"
      // (a city on the same card), from "CINSI" half the alphabet.
      const tol = w.length >= 9 ? 2 : w.length >= 7 ? 1 : 0;
      if (!exact && (codeConflicts || !fuzzyContains(c, w, tol))) continue;
      if (codeConflicts && w.length < 7) continue;
      const score = (codeAgrees ? 2 : 0) + w.length / 20 + (exact ? 0.5 : 0);
      if (!best || score > best.score) best = { key: f.key, score, word: w };
    }
  }
  if (!best && code) {
    const byCode = FIELDS.find((f) => f.codes.includes(code));
    if (byCode && c.length <= 14) best = { key: byCode.key, score: 1, word: "" };
  }
  if (!best) return null;
  // What is left once the code and the label words are gone.
  let rest = F(text).replace(/^\s*[(\[{][^)\]}]*[)\]}]\s*/, "");
  for (const w of FIELDS.find((f) => f.key === best!.key)!.words) {
    const re = new RegExp(w.split("").join("\\s*"));
    rest = rest.replace(re, "");
  }
  return { key: best.key, inline: rest.replace(/^[\s:.-]+/, "").trim() };
}

function isLabelLine(text: string): boolean {
  if (detectLabel(text)) return true;
  const c = compact(text);
  if (/^[(\[{]\s*[A-Z]\s*[.,]?\s*\d?(\.\d)?\s*[)\]}]/.test(F(text))) return true;
  return LABEL_NOISE.some((w) => c.includes(w));
}

// ── value shapes ──────────────────────────────────────────────────────────────

const FUELS: [RegExp, string][] = [
  [/BENZ|BENS/, "BENZİN"],
  [/DIZ|MOTORIN/, "DİZEL"],
  [/LPG/, "LPG"],
  [/ELEKT/, "ELEKTRİK"],
  [/HIBR|HYBR/, "HİBRİT"],
];

const COLORS = [
  "BEYAZ", "SIYAH", "GRI", "GUMUS", "KIRMIZI", "MAVI", "LACIVERT", "YESIL", "SARI", "TURUNCU",
  "KAHVERENGI", "BEJ", "BORDO", "MOR", "PEMBE", "ALTIN", "BRONZ", "FUME", "KREM", "TURKUAZ",
];

const COLOR_DISPLAY: Record<string, string> = {
  SIYAH: "SİYAH", GRI: "GRİ", GUMUS: "GÜMÜŞ", KIRMIZI: "KIRMIZI", MAVI: "MAVİ", LACIVERT: "LACİVERT",
  YESIL: "YEŞİL", SARI: "SARI", KAHVERENGI: "KAHVERENGİ", FUME: "FÜME", TURKUAZ: "TURKUAZ",
};

/** OCR digit-for-letter slips, applied only where a digit is expected. */
function digitsOf(s: string): string {
  return F(s).replace(/[OQD]/g, "0").replace(/[IL|]/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2");
}

/** dd/mm/yyyy, tolerating a stray trailing digit ("04/01/20145") and odd separators. */
function dateOf(s: string): string | null {
  const m = /(\d{1,2})\s*[./,-]\s*(\d{1,2})\s*[./,-]\s*(\d{4})/.exec(digitsOf(s));
  if (!m) return null;
  return normalizeDate(`${m[1]}.${m[2]}.${m[3]}`);
}

const VIN_FIX: Record<string, string> = { I: "1", O: "0", Q: "0" };

function vinOf(s: string): string | null {
  const c = compact(s);
  const all: string[] = [];
  for (let i = 0; i + 17 <= c.length; i++) {
    const cand = c.slice(i, i + 17).replace(/[IOQ]/g, (ch) => VIN_FIX[ch]!);
    if (isVin(cand)) all.push(cand);
  }
  // An 18-character run ("NZAPMD35…", a stray glyph glued on) has two 17-char
  // windows; the one that opens with a real manufacturer code is the VIN.
  return all.find((v) => WMI_MAKE.has(v.slice(0, 3))) ?? all[0] ?? null;
}

/**
 * World Manufacturer Identifiers (the first three VIN characters) for the
 * makes common on Turkish roads. Used two ways: to pick the right window out
 * of an over-long OCR run, and — once the make is known — to repair a single
 * misread glyph in the WMI ("JVA" → "JYA" on a Yamaha), the most frequent VIN
 * error in the corpus. Never used to invent a VIN.
 */
const WMI: Record<string, string[]> = {
  YAMAHA: ["JYA", "JYE", "JY4", "LBP", "MH3", "VG5", "RKR"],
  HONDA: ["JH2", "JH3", "ZDC", "MLH", "ME4", "LAL", "JHM", "SHH", "NLA", "MRH"],
  SUZUKI: ["JS1", "JS2", "VTT", "LC6", "MB8", "TSM"],
  KAWASAKI: ["JKA", "JKB", "MH4", "ML5", "KL3"],
  DUCATI: ["ZDM"],
  PIAGGIO: ["ZAP", "RP8", "ZD4"],
  VESPA: ["ZAP", "RP8"],
  BMW: ["WB1", "WB3", "WBA", "WBS", "WBY", "WB4", "WB5", "WMW"],
  KTM: ["VBK"],
  TRIUMPH: ["SMT", "SMW"],
  "HARLEY-DAVIDSON": ["1HD", "5HD"],
  APRILIA: ["ZD4"],
  BAJAJ: ["MD2"],
  TVS: ["MD6"],
  SYM: ["RFG", "LWB"],
  KYMCO: ["RFB", "LC2"],
  FIAT: ["ZFA", "NM4", "VF3", "ZFC"],
  RENAULT: ["VF1", "VF6", "VF8", "UU1", "NM2"],
  TOYOTA: ["NMT", "JTD", "JTE", "JTN", "SB1", "VNK", "JT2", "MR0", "AHT"],
  VOLKSWAGEN: ["WVW", "WVG", "WV1", "WV2", "3VW"],
  FORD: ["WF0", "NM0", "1FA", "1FT", "MAJ", "PE1"],
  HYUNDAI: ["NLH", "KMH", "TMA", "MAL"],
  OPEL: ["W0L", "VXK", "W0V"],
  PEUGEOT: ["VF3", "VR3"],
  CITROEN: ["VF7", "VR7"],
  "MERCEDES-BENZ": ["WDB", "WDD", "WDC", "W1K", "W1N", "WDF", "NMB", "W1V"],
  AUDI: ["WAU", "TRU", "WUA"],
  SKODA: ["TMB"],
  SEAT: ["VSS"],
  CUPRA: ["VSS"],
  DACIA: ["UU1"],
  NISSAN: ["SJN", "VSK", "JN1", "MDH"],
  KIA: ["KNA", "KNE", "U5Y"],
  HONDA_AUTO: ["SHH", "JHM", "MRH"],
  TOGG: ["NL1"],
  VOLVO: ["YV1", "YV4"],
  MAZDA: ["JMZ", "JM1"],
  JEEP: ["1C4", "ZAC"],
  CHERY: ["LVV"],
  MG: ["SDP", "LSJ"],
  TESLA: ["5YJ", "7SA", "LRW", "XP7"],
};
const WMI_MAKE = new Map<string, string>(
  Object.entries(WMI).flatMap(([mk, codes]) => codes.map((c) => [c, mk] as [string, string])),
);

/** Repair a one-glyph WMI misread when the make is known. */
export function repairVinForMake(vin: string | null, make: string | null): string | null {
  if (!vin || !make) return vin;
  const key = F(make).replace(/\s+/g, "-");
  const codes = WMI[key] ?? WMI[key.split("-")[0]!];
  if (!codes || codes.includes(vin.slice(0, 3))) return vin;
  const near = codes.filter((c) => levenshtein(c, vin.slice(0, 3), 1) === 1);
  return near.length === 1 ? near[0] + vin.slice(3) : vin;
}

function engineOf(s: string): string | null {
  const c = compact(s).replace(/^MOTORN[O0]?/, "");
  // Motor numbers are 6-20 characters and always carry digits.
  if (c.length < 5 || c.length > 22 || !/\d/.test(c) || !/^[A-Z0-9]+$/.test(c)) return null;
  return c;
}

function yearOf(s: string): number | null {
  const now = new Date().getUTCFullYear();
  const m = /(19[5-9]\d|20\d{2})/.exec(digitsOf(s));
  if (!m) return null;
  const y = Number(m[1]);
  return y <= now + 1 ? y : null;
}

function ccOf(s: string): number | null {
  const m = /(\d{2,5})(?:[.,]\d+)?\s*(?:CM|CC|CM3|$)/.exec(F(s).replace(/\s+/g, " ").trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 49 && n <= 10000 ? n : null;
}

function fuelOf(s: string): string | null {
  const c = compact(s);
  for (const [re, v] of FUELS) if (re.test(c)) return v;
  return null;
}

function colorOf(s: string): string | null {
  const c = compact(s);
  for (const col of COLORS) if (c.includes(col)) return COLOR_DISPLAY[col] ?? col;
  // An unlisted shade ("METALIK GRI" without the space, "SEDEF BEYAZ"…): accept
  // a short all-letter word rather than drop it.
  const w = F(s).trim();
  return /^[A-Z ]{3,24}$/.test(w) ? w : null;
}

/** A make/model is a short run of letters and digits — not a sentence, not a number. */
function nameOf(s: string): string | null {
  const w = deHomoglyph(s).replace(/\s+/g, " ").trim();
  if (w.length < 2 || w.length > 30) return null;
  if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(w)) return null;
  if (/^\d+$/.test(w)) return null;
  return F(w).replace(/[^A-Z0-9 .-]/g, "").trim() || null;
}

/** A make is only a make if the catalogue knows it — this is what keeps a city or a plate out. */
function makeOf(s: string): string | null {
  const n = nameOf(s);
  if (!n) return null;
  const m = matchMake(n) ?? matchMake(n.split(" ")[0]);
  return m ? m.name : null;
}

const SHAPE: Record<FieldKey, (s: string) => unknown> = {
  plate: () => null, // plates are found by the dedicated backstop, see below
  firstReg: dateOf,
  make: makeOf,
  type: nameOf,
  trade: nameOf,
  year: yearOf,
  kind: (s) => (/MOTOS|OTOMOB|KAMYON|PICKUP|MINIBUS|OTOBUS|ARAZI|TRAKTOR/.test(compact(s)) ? compact(s) : null),
  color: colorOf,
  engine: engineOf,
  chassis: vinOf,
  cc: ccOf,
  fuel: fuelOf,
  inspection: dateOf,
};

// ── association ───────────────────────────────────────────────────────────────

/**
 * Candidate values for a label, best first. With boxes: lines starting just
 * below the label (or on its row, to the right) within one field's height,
 * horizontally overlapping the label's column. Without: the next few lines.
 */
function candidates(lines: OcrLine[], idx: number, geometric: boolean): number[] {
  if (!geometric) return [idx + 1, idx + 2, idx + 3].filter((i) => i < lines.length);
  const L = lines[idx]!;
  const colL = L.x - 0.04;
  const colR = L.x + Math.max(L.w, 0.2) + 0.04;
  const out: { i: number; score: number }[] = [];
  lines.forEach((v, i) => {
    if (i === idx) return;
    const dy = v.y - L.y;
    const sameRow = Math.abs(dy) < Math.max(L.h, v.h) * 0.8 && v.x > L.x + L.w - 0.01 && v.x - (L.x + L.w) < 0.12;
    const below = dy > L.h * 0.3 && dy < 0.06;
    const overlaps = v.x < colR && v.x + v.w > colL;
    if (!(sameRow || (below && overlaps))) return;
    const dx = Math.abs(v.x - L.x);
    out.push({ i, score: (sameRow ? 0 : dy) + dx * 0.5 });
  });
  return out.sort((a, b) => a.score - b.score).map((o) => o.i);
}

/**
 * Extract every ruhsat field it can. `lines` may carry real geometry (Vision)
 * or be synthesised from plain text — pass `geometric: false` then.
 */
export function readRuhsat(lines: OcrLine[], geometric = true): RuhsatFields {
  const labels: Label[] = [];
  lines.forEach((l, i) => {
    const d = detectLabel(l.t);
    if (d) labels.push({ key: d.key, line: i, inline: d.inline });
  });

  const found: Partial<Record<FieldKey, unknown>> = {};
  // A field may be labelled twice on some cards (front/back); the first one
  // that yields a well-shaped value wins.
  for (const lab of labels) {
    if (found[lab.key] != null) continue;
    const shape = SHAPE[lab.key];
    // An inline remainder that is really the rest of a garbled label
    // ("(D.3) TICARI ADT" → "TICARI ADT") is not a value.
    const own = FIELDS.find((f) => f.key === lab.key)!.words;
    const inlineIsLabel =
      !!lab.inline &&
      (LABEL_NOISE.some((w) => compact(lab.inline).includes(w)) ||
        own.some((w) => fuzzyContains(compact(lab.inline), w, w.length >= 9 ? 2 : 1)));
    const inline = lab.inline && !inlineIsLabel ? shape(lab.inline) : null;
    if (inline != null) {
      found[lab.key] = inline;
      continue;
    }
    for (const i of candidates(lines, lab.line, geometric)) {
      const t = lines[i]!.t;
      if (isLabelLine(t) && !(lab.key === "chassis" && vinOf(t))) continue;
      const v = shape(t);
      if (v != null) {
        found[lab.key] = v;
        break;
      }
    }
  }

  // The chassis number is the one field with a checkable global shape: if the
  // label was missed, a lone 17-character VIN anywhere on the card is it.
  if (found.chassis == null) {
    for (const l of lines) {
      const v = vinOf(l.t);
      if (v) {
        found.chassis = v;
        break;
      }
    }
  }

  // The inspection note is the one date printed with hyphens ("19-08-2026");
  // registration dates use slashes. If the (Z.2) box was not found, a hyphenated
  // date anywhere on the card is it.
  if (found.inspection == null) {
    for (const l of lines) {
      const m = /(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{4})/.exec(digitsOf(l.t));
      const d = m ? normalizeDate(`${m[1]}.${m[2]}.${m[3]}`) : null;
      if (d) {
        found.inspection = d;
        break;
      }
    }
  }

  const make = (found.make as string | undefined) ?? null;
  const trade = (found.trade as string | undefined) ?? null;
  const type = (found.type as string | undefined) ?? null;
  return {
    plate: null,
    firstRegistrationDate: (found.firstReg as string | undefined) ?? null,
    make,
    // The trade name ("MT 09", "COROLLA") is what an owner calls the car; the
    // type code ("RN29") is the fallback when the trade name is unreadable.
    model: trade ?? type,
    vehicleTypeHint: (found.kind as string | undefined) ?? null,
    year: (found.year as number | undefined) ?? null,
    color: (found.color as string | undefined) ?? null,
    engineNo: (found.engine as string | undefined) ?? null,
    chassisNo: repairVinForMake((found.chassis as string | undefined) ?? null, make),
    cylinderCc: (found.cc as number | undefined) ?? null,
    fuelType: (found.fuel as string | undefined) ?? null,
    muayeneExpiresOn: (found.inspection as string | undefined) ?? null,
    labelsFound: new Set(labels.map((l) => l.key)).size,
  };
}

/** Plain OCR text → lines without geometry. */
export function linesFromText(text: string): OcrLine[] {
  return text
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t, i) => ({ t, x: 0, y: i, w: 0, h: 0 }));
}
