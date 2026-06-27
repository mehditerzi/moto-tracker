/**
 * Vehicle (motorcycle + car) make/model matcher.
 *
 * Canonicalizes the make/model an OCR/LLM pass extracted against the bundled
 * catalog (vPIC makes + curated Turkish-market overlay + API-Ninjas, see
 * db/seed/vehicleCatalog.generated.ts). Strategy:
 *
 *   make:  exact normalized hit against ALL catalog makes + aliases →
 *          else fuzzy ONLY against the curated overlay makes (the trusted set,
 *          so the long tail of vPIC junk names can't produce false positives).
 *   model: once a make is known, exact then fuzzy against that make's models.
 *
 * A confident match rewrites the value to the catalog's canonical spelling and
 * reports it so the pipeline can nudge confidence up; no match leaves the value
 * untouched. Pure and synchronous — loads the module once, no DB dependency, so
 * it works identically in tests and prod.
 */
import { VEHICLE_CATALOG, type CatalogMake, type VehicleType } from "../db/seed/vehicleCatalog.generated.js";

export type { VehicleType };

/** Turkish-aware normalization. MUST stay byte-identical to norm() in scripts/fetch-moto-catalog.mjs. */
export function norm(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .replace(/İ/g, "I").replace(/ı/g, "I")
    .replace(/Ş/g, "S").replace(/ş/g, "S")
    .replace(/Ğ/g, "G").replace(/ğ/g, "G")
    .replace(/Ü/g, "U").replace(/ü/g, "U")
    .replace(/Ö/g, "O").replace(/ö/g, "O")
    .replace(/Ç/g, "C").replace(/ç/g, "C")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

// ── indices, built once ───────────────────────────────────────────────────────
interface MakeIndex {
  byNorm: Map<string, CatalogMake>; // exact make norm + every alias norm
  overlay: CatalogMake[]; // curated subset, fuzzy candidates only
}

let _idx: MakeIndex | null = null;
function index(): MakeIndex {
  if (_idx) return _idx;
  const byNorm = new Map<string, CatalogMake>();
  const overlay: CatalogMake[] = [];
  // Pass 1: overlay makes + aliases win (curated, canonical spelling).
  for (const m of VEHICLE_CATALOG) {
    if (m.source !== "overlay") continue;
    overlay.push(m);
    byNorm.set(m.norm, m);
    for (const a of m.aliases) if (!byNorm.has(a)) byNorm.set(a, m);
  }
  // Pass 2: vPIC makes fill breadth without clobbering overlay entries.
  for (const m of VEHICLE_CATALOG) {
    if (m.source === "overlay") continue;
    if (!byNorm.has(m.norm)) byNorm.set(m.norm, m);
  }
  _idx = { byNorm, overlay };
  return _idx;
}

// ── fuzzy primitives ──────────────────────────────────────────────────────────
/** Levenshtein distance, capped early once it exceeds `max` (returns max+1). */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** Similarity in [0,1] from edit distance over the longer string. */
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const longer = Math.max(a.length, b.length);
  if (longer === 0) return 1;
  return 1 - levenshtein(a, b) / longer;
}

// ── public API ────────────────────────────────────────────────────────────────
export interface MakeMatch {
  /** Canonical make name from the catalog. */
  name: string;
  /** Catalog row (for model lookups). */
  make: CatalogMake;
  /** "exact" (norm/alias hit) or "fuzzy". */
  via: "exact" | "fuzzy";
  /** 1 for exact; similarity score for fuzzy. */
  score: number;
}

export interface ModelMatch {
  name: string;
  via: "exact" | "fuzzy";
  score: number;
  type: VehicleType;
}

/** Minimum similarity to accept a fuzzy make match. Short brands need to be stricter. */
function makeThreshold(len: number): number {
  if (len <= 4) return 0.86; // e.g. "KTM", "TVS", "SYM" — 1 edit on a 4-char string = 0.75, too loose
  if (len <= 7) return 0.8;
  return 0.78;
}

export function matchMake(raw: string | null | undefined): MakeMatch | null {
  const n = norm(raw);
  if (!n || n.length < 2) return null;
  const { byNorm, overlay } = index();

  const exact = byNorm.get(n);
  if (exact) return { name: exact.name, make: exact, via: "exact", score: 1 };

  // Fuzzy only against curated overlay makes + their aliases.
  let best: MakeMatch | null = null;
  for (const m of overlay) {
    for (const cand of [m.norm, ...m.aliases]) {
      const s = similarity(n, cand);
      if (s >= makeThreshold(Math.max(n.length, cand.length)) && (!best || s > best.score)) {
        best = { name: m.name, make: m, via: "fuzzy", score: s };
      }
    }
  }
  return best;
}

export function matchModel(make: CatalogMake, raw: string | null | undefined): ModelMatch | null {
  const n = norm(raw);
  if (!n || n.length < 2 || make.models.length === 0) return null;

  for (const md of make.models) {
    if (md.norm === n) return { name: md.name, via: "exact", score: 1, type: md.type };
  }
  // Models carry digits that must not drift (CB500F vs CB650F), so require a
  // high bar and identical digit sequences.
  const digits = (s: string) => s.replace(/\D/g, "");
  const nDigits = digits(n);
  let best: ModelMatch | null = null;
  for (const md of make.models) {
    if (digits(md.norm) !== nDigits) continue;
    const s = similarity(n, md.norm);
    if (s >= 0.84 && (!best || s > best.score)) {
      best = { name: md.name, via: "fuzzy", score: s, type: md.type };
    }
  }
  return best;
}

export interface CanonicalizeResult {
  make: string | null;
  model: string | null;
  makeMatched: boolean;
  modelMatched: boolean;
  makeVia: "exact" | "fuzzy" | null;
  modelVia: "exact" | "fuzzy" | null;
}

/**
 * Canonicalize an extracted (make, model) pair. Rewrites each to its catalog
 * spelling when matched; otherwise returns the trimmed original. Never throws.
 */
export function canonicalize(
  rawMake: string | null | undefined,
  rawModel: string | null | undefined,
): CanonicalizeResult {
  const mk = matchMake(rawMake);
  const make = mk ? mk.name : (rawMake?.trim() || null);

  let model = rawModel?.trim() || null;
  let modelMatched = false;
  let modelVia: "exact" | "fuzzy" | null = null;
  if (mk) {
    const md = matchModel(mk.make, rawModel);
    if (md) {
      model = md.name;
      modelMatched = true;
      modelVia = md.via;
    }
  }

  return {
    make,
    model,
    makeMatched: !!mk,
    modelMatched,
    makeVia: mk ? mk.via : null,
    modelVia,
  };
}

/**
 * Best-effort vehicle type for an extracted (make, model). Most specific signal
 * wins: a matched model carries its own type; otherwise a make that exists under
 * exactly one type implies it. Returns null when genuinely ambiguous (e.g. a
 * make like Honda that builds both, with no model match) — the caller decides
 * the default then.
 */
export function inferVehicleType(
  rawMake: string | null | undefined,
  rawModel: string | null | undefined,
): VehicleType | null {
  const mk = matchMake(rawMake);
  if (!mk) return null;
  const md = matchModel(mk.make, rawModel);
  if (md) return md.type;
  if (mk.make.types.length === 1) return mk.make.types[0]!;
  return null;
}

/** Catalog stats, for the read route / diagnostics. */
export function catalogStats(): { makes: number; models: number; overlay: number } {
  const { overlay } = index();
  return {
    makes: VEHICLE_CATALOG.length,
    models: VEHICLE_CATALOG.reduce((s, m) => s + m.models.length, 0),
    overlay: overlay.length,
  };
}
