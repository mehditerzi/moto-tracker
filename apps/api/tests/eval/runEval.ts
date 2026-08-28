/**
 * OCR eval runner — see harness.ts for why this exists.
 *
 *   pnpm --filter @mototracker/api ocr:eval -- extract
 *   pnpm --filter @mototracker/api ocr:eval -- parse --models gemma4:e2b,gemma4:latest,gemma4:26b
 *   pnpm --filter @mototracker/api ocr:eval -- pipeline
 *   pnpm --filter @mototracker/api ocr:eval -- deterministic
 *   pnpm --filter @mototracker/api ocr:eval -- throughput --concurrency 1,2,3,4
 *
 * Runs against whatever Ollama `OLLAMA_URL` points at. Everything is local:
 * no document ever leaves the machine, which is what the privacy policy
 * promises and is the reason this stack is Ollama + Tesseract in the first
 * place.
 */
process.env.NODE_ENV ??= "development";
process.env.APP_BASE_URL ??= "http://localhost:8787";
process.env.SESSION_SECRET ??= "ocr-eval-secret-ocr-eval-secret";
process.env.DATABASE_PATH ??= ":memory:";
// Point the eval at the host Ollama even when .env is written for Docker.
if (process.env.OLLAMA_URL?.includes("host.docker.internal")) {
  process.env.OLLAMA_URL = "http://localhost:11434";
}

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  loadCases,
  scoreField,
  tally,
  pct,
  quantile,
  SCORED_FIELDS,
  type EvalCase,
  type RunResult,
  type ScoredField,
} from "./harness.js";

const CACHE = "data/ocr-eval/text";
const OUT = "data/ocr-eval/results";

// pnpm forwards `-- deterministic` with the separator intact, so a bare "--"
// shows up as an argument. Drop it rather than making the documented command
// line a lie.
const ARGV = process.argv.slice(2).filter((a) => a !== "--");

function arg(name: string, fallback?: string): string | undefined {
  const i = ARGV.indexOf(`--${name}`);
  if (i >= 0 && ARGV[i + 1]) return ARGV[i + 1];
  return fallback;
}

// ── scoring glue ──────────────────────────────────────────────────────────────

type Flat = Partial<Record<ScoredField, unknown>>;

/**
 * The pre-fix auto-apply rule, kept here (never in src/) purely so each report
 * can show what the change bought. Only a document whose doc_type is itself a
 * dated type could contribute, and only via the identically-named date field.
 */
function legacyWouldApply(p: { docType: string; confidence: number; dates: Record<string, string | null> }, threshold: number): boolean {
  const key = { sigorta: "sigortaExpiresOn", kasko: "kaskoExpiresOn", muayene: "muayeneExpiresOn" }[p.docType];
  return !!key && p.confidence >= threshold && !!p.dates[key];
}

function flatten(p: {
  docType: string;
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  firstRegistrationDate: string | null;
  chassisNo: string | null;
  engineNo: string | null;
  cylinderCc: number | null;
  dates: { sigortaExpiresOn: string | null; kaskoExpiresOn: string | null; muayeneExpiresOn: string | null };
}): Flat {
  return {
    docType: p.docType,
    plate: p.plate,
    make: p.make,
    model: p.model,
    year: p.year,
    firstRegistrationDate: p.firstRegistrationDate,
    chassisNo: p.chassisNo,
    engineNo: p.engineNo,
    cylinderCc: p.cylinderCc,
    muayeneExpiresOn: p.dates.muayeneExpiresOn,
    sigortaExpiresOn: p.dates.sigortaExpiresOn,
    kaskoExpiresOn: p.dates.kaskoExpiresOn,
  };
}

function judge(c: EvalCase, got: Flat): RunResult["verdicts"] {
  const v: RunResult["verdicts"] = {};
  for (const f of SCORED_FIELDS) {
    if (c.unscored.includes(f)) {
      v[f] = "skipped";
      continue;
    }
    v[f] = scoreField(f, got[f], (c.expected as unknown as Record<string, unknown>)[f]);
  }
  return v;
}

function report(label: string, results: RunResult[], extra: Record<string, string> = {}): void {
  const { fields, totals } = tally(results);
  const ms = results.map((r) => r.ms);
  const failures = results.filter((r) => r.error).length;
  const applied = results.filter((r) => r.autoApplied).length;
  const legacy = results.filter((r) => r.autoAppliedLegacy).length;

  console.log(`\n══ ${label} ══  (${results.length} documents)`);
  console.log("field                  correct  wrong  missed  halluc.   acc");
  for (const f of SCORED_FIELDS) {
    const t = fields[f];
    const n = t.correct + t.wrong + t.missed + t.hallucinated;
    if (n === 0) continue;
    console.log(
      `${f.padEnd(22)}${String(t.correct).padStart(7)}${String(t.wrong).padStart(7)}` +
        `${String(t.missed).padStart(8)}${String(t.hallucinated).padStart(9)}  ${pct(t.correct, n)}`,
    );
  }
  console.log(
    `${"OVERALL".padEnd(22)}${String(totals.correct).padStart(7)}${String(totals.wrong).padStart(7)}` +
      `${String(totals.missed).padStart(8)}${String(totals.hallucinated).padStart(9)}  ${pct(totals.correct, totals.scored)}`,
  );
  console.log(
    `hard failures: ${failures}/${results.length}   auto-applies: ${applied}/${results.length} ` +
      `(legacy doc_type-matched rule: ${legacy}/${results.length})   ` +
      `latency p50 ${(quantile(ms, 0.5) / 1000).toFixed(1)}s p90 ${(quantile(ms, 0.9) / 1000).toFixed(1)}s ` +
      `mean ${(ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length) / 1000).toFixed(1)}s`,
  );
  for (const [k, val] of Object.entries(extra)) console.log(`${k}: ${val}`);

  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${label.replace(/[^\w.-]+/g, "_")}.json`, JSON.stringify({ fields, totals, results }, null, 1));
}

// ── modes ─────────────────────────────────────────────────────────────────────

/** Stage 1: how good is each image→text engine, and how fast? */
async function modeExtract(cases: EvalCase[]): Promise<void> {
  const { runTextExtract } = await import("../../src/ocr/ollamaClient.js");
  const { extractTextWithTesseract } = await import("../../src/ocr/tesseractClient.js");
  const models = (arg("models", "glm-ocr:latest") ?? "").split(",").filter(Boolean);

  for (const engine of [...models, "tesseract"]) {
    const rows: { id: string; ms: number; chars: number; plate: boolean; date: boolean }[] = [];
    for (const c of cases) {
      const ac = new AbortController();
      const t0 = performance.now();
      let text = "";
      try {
        text =
          engine === "tesseract"
            ? await extractTextWithTesseract(c.image, ac.signal)
            : await runTextExtract(c.image, engine, undefined, ac.signal);
      } catch (e) {
        text = "";
        console.error(`  ${c.id}: ${(e as Error).message}`);
      }
      const ms = performance.now() - t0;
      const flat = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const plate = c.expected.plate ? flat.includes(c.expected.plate.replace(/\s/g, "")) : false;
      const d = c.expected.muayeneExpiresOn;
      const date = d ? new RegExp(`${d.slice(8, 10)}.?${d.slice(5, 7)}.?${d.slice(0, 4)}`).test(text.replace(/\s/g, "")) : false;
      rows.push({ id: c.id, ms, chars: text.length, plate, date });
      if (engine !== "tesseract") writeFileSync(`${CACHE}/${c.id}.${engine.replace(/[:/]/g, "_")}.txt`, text);
    }
    const ms = rows.map((r) => r.ms);
    const dateable = cases.filter((c) => c.expected.muayeneExpiresOn).length;
    console.log(
      `\n${engine.padEnd(18)} chars(median) ${quantile(rows.map((r) => r.chars), 0.5)}  ` +
        `plate-present ${rows.filter((r) => r.plate).length}/${rows.length}  ` +
        `muayene-date-present ${rows.filter((r) => r.date).length}/${dateable}  ` +
        `p50 ${(quantile(ms, 0.5) / 1000).toFixed(1)}s p90 ${(quantile(ms, 0.9) / 1000).toFixed(1)}s`,
    );
  }
}

function cachedText(id: string, engine = "glm-ocr:latest"): string | null {
  const p = `${CACHE}/${id}.${engine === "glm-ocr:latest" ? "glmocr" : engine.replace(/[:/]/g, "_")}.txt`;
  return existsSync(p) ? readFileSync(p, "utf-8") : null;
}

/** Stage 2: which model turns extracted text into correct JSON, and how fast? */
async function modeParse(cases: EvalCase[]): Promise<void> {
  const { runTextOcr } = await import("../../src/ocr/ollamaClient.js");
  const { safeParseOcr } = await import("../../src/ocr/parser.js");
  const { backstopFromText } = await import("../../src/ocr/backstop.js");
  const { validateAndCorrect } = await import("../../src/ocr/validators.js");
  const { applicableDatedItems } = await import("../../src/ocr/autoApply.js");
  const raw = ARGV.includes("--raw"); // skip backstop+validators
  const threshold = Number(arg("threshold", "0.7"));

  for (const model of (arg("models", "gemma4:latest") ?? "").split(",").filter(Boolean)) {
    const results: RunResult[] = [];
    for (const c of cases) {
      const src = cachedText(c.id);
      if (src == null) throw new Error(`no cached extraction for ${c.id} — run \`ocr:eval extract\` first`);
      const ac = new AbortController();
      const t0 = performance.now();
      let parsed;
      let error: string | undefined;
      try {
        const out = await runTextOcr(src, model, undefined, ac.signal);
        const sp = safeParseOcr(out.rawText);
        parsed = sp.parsed;
        if (sp.error) error = sp.error;
      } catch (e) {
        error = (e as Error).message;
        parsed = safeParseOcr("{}").parsed;
      }
      if (!raw) {
        parsed = validateAndCorrect(backstopFromText(parsed, src)).parsed;
      }
      const ms = performance.now() - t0;
      const got = flatten(parsed);
      results.push({
        id: c.id,
        got,
        verdicts: judge(c, got),
        confidence: parsed.confidence,
        autoApplied: parsed.confidence >= threshold && applicableDatedItems(parsed).length > 0,
        autoAppliedLegacy: legacyWouldApply(parsed, threshold),
        error,
        ms,
      });
    }
    report(`parse-${model}${raw ? "-raw" : ""}`, results);
  }
}

/** Deterministic layers only, over cached extractions — no inference, instant. */
async function modeDeterministic(cases: EvalCase[]): Promise<void> {
  const { safeParseOcr } = await import("../../src/ocr/parser.js");
  const { backstopFromText } = await import("../../src/ocr/backstop.js");
  const { validateAndCorrect } = await import("../../src/ocr/validators.js");
  const { applicableDatedItems } = await import("../../src/ocr/autoApply.js");
  const threshold = Number(arg("threshold", "0.7"));
  const results: RunResult[] = [];
  for (const c of cases) {
    const src = cachedText(c.id) ?? "";
    const t0 = performance.now();
    // Empty LLM output on purpose: this measures what the deterministic
    // recovery layer alone can pull out of the OCR text, i.e. the floor the
    // pipeline degrades to when the model returns nothing usable.
    const parsed = validateAndCorrect(backstopFromText(safeParseOcr("").parsed, src)).parsed;
    const got = flatten(parsed);
    results.push({
      id: c.id,
      got,
      verdicts: judge(c, got),
      confidence: parsed.confidence,
      autoApplied: parsed.confidence >= threshold && applicableDatedItems(parsed).length > 0,
      autoAppliedLegacy: legacyWouldApply(parsed, threshold),
      ms: performance.now() - t0,
    });
  }
  report("deterministic-backstop-only", results);
}

/** The number that matters: the real pipeline, end to end, per document. */
async function modePipeline(cases: EvalCase[]): Promise<void> {
  const { runOcrPipeline } = await import("../../src/ocr/worker.js");
  const { safeParseOcr } = await import("../../src/ocr/parser.js");
  const { backstopFromText } = await import("../../src/ocr/backstop.js");
  const { validateAndCorrect } = await import("../../src/ocr/validators.js");
  const { applicableDatedItems } = await import("../../src/ocr/autoApply.js");
  const threshold = Number(arg("threshold", "0.7"));
  const label = arg("label", "pipeline")!;

  const results: RunResult[] = [];
  for (const c of cases) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error("eval deadline")), 300_000);
    const t0 = performance.now();
    let error: string | undefined;
    let parsed;
    let stages: string[] = [];
    try {
      const out = await runOcrPipeline(c.image, ac.signal);
      stages = out.stages ?? [];
      const sp = safeParseOcr(out.rawText);
      parsed = sp.parsed;
      if (sp.error) error = sp.error;
      parsed = validateAndCorrect(backstopFromText(parsed, out.sourceText)).parsed;
    } catch (e) {
      error = (e as Error).message;
      parsed = safeParseOcr("{}").parsed;
    } finally {
      clearTimeout(timer);
    }
    const ms = performance.now() - t0;
    const got = flatten(parsed);
    const r: RunResult = {
      id: c.id,
      got,
      verdicts: judge(c, got),
      confidence: parsed.confidence,
      autoApplied: parsed.confidence >= threshold && applicableDatedItems(parsed).length > 0,
      autoAppliedLegacy: legacyWouldApply(parsed, threshold),
      error,
      ms,
      stages,
    };
    results.push(r);
    console.log(
      `  ${c.id} ${(ms / 1000).toFixed(1)}s conf=${parsed.confidence} plate=${parsed.plate ?? "-"} ` +
        `mua=${parsed.dates.muayeneExpiresOn ?? "-"} [${stages.join(">")}]${error ? ` ERR ${error}` : ""}`,
    );
  }
  report(label, results);
}

/** Throughput curve: documents/minute at each OCR_CONCURRENCY. */
async function modeThroughput(cases: EvalCase[]): Promise<void> {
  const { runOcrPipeline } = await import("../../src/ocr/worker.js");
  const levels = (arg("concurrency", "1,2,3,4") ?? "").split(",").map(Number);
  const n = Number(arg("docs", String(Math.min(12, cases.length))));
  const batch = cases.slice(0, n);
  for (const level of levels) {
    const queue = [...batch];
    const perDoc: number[] = [];
    const t0 = performance.now();
    await Promise.all(
      Array.from({ length: level }, async () => {
        for (;;) {
          const c = queue.shift();
          if (!c) return;
          const ac = new AbortController();
          const s = performance.now();
          try {
            await runOcrPipeline(c.image, ac.signal);
          } catch {
            /* latency is what we are measuring here */
          }
          perDoc.push(performance.now() - s);
        }
      }),
    );
    const wall = (performance.now() - t0) / 1000;
    console.log(
      `concurrency ${level}: ${batch.length} docs in ${wall.toFixed(1)}s = ` +
        `${((batch.length / wall) * 60).toFixed(1)} docs/min  ` +
        `per-doc p50 ${(quantile(perDoc, 0.5) / 1000).toFixed(1)}s p90 ${(quantile(perDoc, 0.9) / 1000).toFixed(1)}s`,
    );
  }
}

async function main(): Promise<void> {
  const mode = ARGV[0];
  const cases = loadCases(resolveRoot());
  const only = arg("only");
  const subset = only ? cases.filter((c) => c.id.startsWith(only)) : cases;
  switch (mode) {
    case "extract":
      return modeExtract(subset);
    case "parse":
      return modeParse(subset);
    case "deterministic":
      return modeDeterministic(subset);
    case "pipeline":
      return modePipeline(subset);
    case "throughput":
      return modeThroughput(subset);
    default:
      console.log(readFileSync(new URL(import.meta.url), "utf-8").split("*/")[0]);
      process.exitCode = 1;
  }
}

/** The corpus paths are repo-root relative; the script runs from apps/api. */
function resolveRoot(): string {
  return process.env.OCR_EVAL_ROOT ?? new URL("../../../../", import.meta.url).pathname;
}

process.chdir(resolveRoot());
void main();
