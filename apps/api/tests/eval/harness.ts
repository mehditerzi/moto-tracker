/**
 * OCR evaluation harness.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every claim about the OCR pipeline before this file was "it looks better".
 * The pipeline's headline promise — photograph a muayene/ruhsat card and have
 * its renewal date filled in for you — had fired exactly zero times across 25
 * production documents, and nobody could tell which stage was at fault because
 * nothing was scored.
 *
 * So: score extraction against known-correct values, field by field, and print
 * accuracy AND latency for every stage and model. Everything in `docs/ocr.md`
 * is a number this harness produced.
 *
 * PRIVACY
 * -------
 * The corpus is real user documents: they contain TC kimlik numbers, home
 * addresses and owner names. Nothing here is committed. Cases live in
 * `data/ocr-eval/cases.json` (the whole `data/` tree is gitignored) and the
 * images stay where they were uploaded. `pnpm ocr:eval` is a local tool, not
 * CI. The CI-safe regression tests over the same failure SHAPES — with invented
 * plates and VINs — are in `tests/ocr.*.test.ts`.
 *
 * USAGE
 *   pnpm --filter @mototracker/api ocr:eval -- --help
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface Expected {
  docType: string;
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  firstRegistrationDate: string | null;
  muayeneExpiresOn: string | null;
  sigortaExpiresOn: string | null;
  kaskoExpiresOn: string | null;
  chassisNo: string | null;
  engineNo: string | null;
  cylinderCc: number | null;
  color: string | null;
  fuelType: string | null;
}

export interface EvalCase {
  id: string;
  image: string;
  expected: Expected;
  /** Fields the photo does not actually show — never scored. */
  unscored: string[];
}

/** Fields scored, in report order. `plate` and `muayeneExpiresOn` carry the product. */
export const SCORED_FIELDS = [
  "docType",
  "plate",
  "muayeneExpiresOn",
  "sigortaExpiresOn",
  "kaskoExpiresOn",
  "firstRegistrationDate",
  "make",
  "model",
  "year",
  "chassisNo",
  "engineNo",
  "cylinderCc",
] as const;
export type ScoredField = (typeof SCORED_FIELDS)[number];

const CASES_PATH = process.env.OCR_EVAL_CASES ?? "data/ocr-eval/cases.json";

export function loadCases(root = process.cwd()): EvalCase[] {
  const p = resolve(root, CASES_PATH);
  if (!existsSync(p)) {
    throw new Error(
      `No eval corpus at ${p}.\n` +
        `The corpus is real user documents and is deliberately not committed.\n` +
        `See docs/ocr.md → "Rebuilding the eval corpus".`,
    );
  }
  return JSON.parse(readFileSync(p, "utf-8")) as EvalCase[];
}

// ── comparison ────────────────────────────────────────────────────────────────

/**
 * Loose string equality for free-text fields. Case-folds Turkish dotted/dotless
 * i, strips punctuation and collapses whitespace, so "MT 09" == "MT-09" and
 * "SİYAH" == "SIYAH". Identifiers (plate/VIN) are compared with `sameId`, which
 * is strict — a VIN that differs by one character is a different vehicle.
 */
export function sameText(a: unknown, b: unknown): boolean {
  const n = (v: unknown) =>
    v == null
      ? null
      : String(v)
          .toUpperCase()
          .replace(/İ/g, "I")
          .replace(/I/g, "I")
          .replace(/Ş/g, "S")
          .replace(/Ğ/g, "G")
          .replace(/Ü/g, "U")
          .replace(/Ö/g, "O")
          .replace(/Ç/g, "C")
          .replace(/[^A-Z0-9]/g, "");
  return n(a) === n(b);
}

export function sameId(a: unknown, b: unknown): boolean {
  const n = (v: unknown) => (v == null ? null : String(v).toUpperCase().replace(/[^A-Z0-9]/g, ""));
  return n(a) === n(b);
}

export type Verdict = "correct" | "wrong" | "missed" | "hallucinated" | "skipped";

/**
 * Score one field.
 *   correct       — matches (including both-absent)
 *   missed        — the document has a value, extraction returned null.
 *                   Costs the user a manual edit.
 *   wrong         — extraction returned a DIFFERENT value. Much worse than
 *                   missed: a wrong expiry date is a reminder for the wrong day
 *                   that the user has no reason to distrust.
 *   hallucinated  — the document has no such value and extraction invented one.
 */
export function scoreField(field: ScoredField, got: unknown, want: unknown): Verdict {
  const cmp = field === "plate" || field === "chassisNo" || field === "engineNo" ? sameId : sameText;
  const gotNull = got == null || got === "";
  const wantNull = want == null || want === "";
  if (wantNull && gotNull) return "correct";
  if (wantNull) return "hallucinated";
  if (gotNull) return "missed";
  return cmp(got, want) ? "correct" : "wrong";
}

export interface FieldTally {
  correct: number;
  wrong: number;
  missed: number;
  hallucinated: number;
}

export interface RunResult {
  id: string;
  /** Flattened extraction under the same keys as `Expected`. */
  got: Partial<Record<ScoredField, unknown>>;
  verdicts: Partial<Record<ScoredField, Verdict>>;
  confidence: number;
  /** Would this scan have created a dated_item without a human? */
  autoApplied: boolean;
  /**
   * Same question under the PRE-FIX rule ("only the date whose name matches
   * doc_type"), so every run prints its own before/after instead of asking the
   * reader to trust a number from a different run.
   */
  autoAppliedLegacy: boolean;
  /** Set when the document failed outright (the 16% production failure mode). */
  error?: string;
  ms: number;
  stages?: string[];
}

export function tally(results: RunResult[]): {
  fields: Record<ScoredField, FieldTally>;
  totals: FieldTally & { scored: number };
} {
  const fields = {} as Record<ScoredField, FieldTally>;
  for (const f of SCORED_FIELDS) fields[f] = { correct: 0, wrong: 0, missed: 0, hallucinated: 0 };
  const totals = { correct: 0, wrong: 0, missed: 0, hallucinated: 0, scored: 0 };
  for (const r of results) {
    for (const f of SCORED_FIELDS) {
      const v = r.verdicts[f];
      if (!v || v === "skipped") continue;
      fields[f][v]++;
      totals[v]++;
      totals.scored++;
    }
  }
  return { fields, totals };
}

export function pct(n: number, d: number): string {
  if (d === 0) return "  n/a";
  return `${((n / d) * 100).toFixed(0).padStart(3)}%`;
}

export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.floor(q * s.length));
  return s[i]!;
}
