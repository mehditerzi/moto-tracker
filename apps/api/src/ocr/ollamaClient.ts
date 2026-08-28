import fs from "node:fs/promises";
import { config } from "../config.js";
import { OCR_SYSTEM_PROMPT, buildUserPrompt, buildTextParsePrompt } from "./prompt.js";

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
}

// Ollama structured-output schema (draft-07). All top-level fields are in
// required so the grammar forces the model to emit every key. Nullable fields
// use anyOf so the model can output null when it can't extract a value.
// Strings carry maxLength so a rambling model is cut off by the grammar
// instead of overflowing num_predict mid-string (= unterminated JSON); no
// real field on these documents exceeds 80 chars.
const N = (t: "string" | "integer" | "number") =>
  t === "string"
    ? { anyOf: [{ type: "string", maxLength: 80 }, { type: "null" }] }
    : { anyOf: [{ type: t }, { type: "null" }] };

const OCR_FORMAT_SCHEMA = {
  type: "object",
  properties: {
    doc_type: { type: "string", enum: ["ruhsat", "sigorta", "kasko", "muayene", "yakit", "unknown"] },
    plate: N("string"),
    make: N("string"),
    model: N("string"),
    year: N("integer"),
    first_registration_date: N("string"),
    color: N("string"),
    chassis_no: N("string"),
    engine_no: N("string"),
    cylinder_cc: N("integer"),
    fuel_type: N("string"),
    dates: {
      type: "object",
      properties: {
        sigorta_expires_on: N("string"),
        kasko_expires_on: N("string"),
        muayene_expires_on: N("string"),
      },
      required: ["sigorta_expires_on", "kasko_expires_on", "muayene_expires_on"],
    },
    fuel: {
      type: "object",
      properties: {
        filled_on: N("string"),
        liters: N("number"),
        total_cost: N("number"),
        unit_price: N("number"),
      },
      required: ["filled_on", "liters", "total_cost", "unit_price"],
    },
    confidence: { type: "number" },
  },
  required: [
    "doc_type", "plate", "make", "model", "year", "first_registration_date", "color",
    "chassis_no", "engine_no", "cylinder_cc", "fuel_type", "dates", "fuel", "confidence",
  ],
};

/**
 * Can this model actually look at an image?
 *
 * Asking matters because getting it wrong is silent and expensive. Sending a
 * base64 photo to a text-only model does not error — Ollama accepts the request
 * and the model answers about an image it never saw, which under a JSON grammar
 * means a well-formed object full of nulls with a confident-looking score, and
 * without a grammar means an empty string that blows up the parser. Both cost
 * the full generation time first.
 *
 * `/api/show` is the authority here; the capability list in `/api/tags` is not
 * always populated. Cached per model+host: it is a property of the installed
 * weights, and a boot-time answer stays true until someone re-pulls the model.
 */
const visionCapability = new Map<string, Promise<boolean>>();

export function __resetVisionCapabilityCacheForTests(): void {
  visionCapability.clear();
}

export async function modelSupportsVision(model: string, baseUrl = config.OLLAMA_URL): Promise<boolean> {
  const key = `${baseUrl}|${model}`;
  const cached = visionCapability.get(key);
  if (cached) return cached;
  const probe = (async () => {
    try {
      const res = await fetch(`${baseUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return true; // Can't tell — don't block the fallback on a probe failure.
      const json = (await res.json()) as { capabilities?: string[] };
      if (!Array.isArray(json.capabilities)) return true;
      return json.capabilities.includes("vision");
    } catch {
      return true;
    }
  })();
  visionCapability.set(key, probe);
  return probe;
}

export async function runVisionOcr(
  imagePath: string,
  model = config.OLLAMA_VISION_MODEL,
  baseUrl = config.OLLAMA_URL,
  signal?: AbortSignal,
): Promise<{ rawText: string; model: string }> {
  if (!model) throw new Error("No vision model configured");
  if (!(await modelSupportsVision(model, baseUrl))) {
    throw new Error(
      `Vision model "${model}" has no vision capability — set OLLAMA_VISION_MODEL to a model that does`,
    );
  }
  const buf = await fs.readFile(imagePath);
  const base64 = buf.toString("base64");

  const body = {
    model,
    prompt: `${OCR_SYSTEM_PROMPT}\n\n${buildUserPrompt()}`,
    images: [base64],
    format: OCR_FORMAT_SCHEMA,
    stream: false,
    keep_alive: "10m",
    options: { num_predict: 1536 },
  };

  const res = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // Caller-supplied signal carries the shared pipeline deadline; fall back to
    // a standalone timeout when called directly (e.g. tooling).
    signal: signal ?? AbortSignal.timeout(config.OCR_TIMEOUT_MS),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Ollama returned ${res.status}: ${txt.slice(0, 500)}`);
  }

  const json = (await res.json()) as OllamaGenerateResponse;
  if (typeof json.response !== "string") {
    throw new Error("Ollama response missing 'response' string");
  }
  return { rawText: json.response, model: json.model ?? model };
}

/**
 * Tidy raw OCR-model output: drop markdown fences, then truncate at the point
 * where the transcription starts repeating from the top. glm-ocr (and similar
 * dedicated OCR models) reliably read the document but often loop the whole
 * transcription until num_predict runs out; one clean copy is all we want.
 */
export function cleanupExtractedText(raw: string): string {
  const t = raw.replace(/```[a-z]*\n?/gi, "").trim();
  const probe = t.slice(0, 60);
  if (probe.length < 20) return t;
  const second = t.indexOf(probe, 20);
  return second > 0 ? t.slice(0, second).trim() : t;
}

/**
 * Plain image→text extraction via a dedicated OCR model (e.g. glm-ocr). No
 * format schema — the model returns the document's text verbatim, which then
 * flows through the same text-parse stage Tesseract output does.
 */
export async function runTextExtract(
  imagePath: string,
  model: string,
  baseUrl = config.OLLAMA_URL,
  signal?: AbortSignal,
): Promise<string> {
  const buf = await fs.readFile(imagePath);
  const body = {
    model,
    prompt: "Bu görseldeki tüm metni oku ve olduğu gibi düz metin olarak döndür. Açıklama ekleme.",
    images: [buf.toString("base64")],
    stream: false,
    keep_alive: "10m",
    options: { num_predict: 2048 },
  };

  const res = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(config.OCR_TIMEOUT_MS),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Ollama returned ${res.status}: ${txt.slice(0, 500)}`);
  }
  const json = (await res.json()) as OllamaGenerateResponse;
  if (typeof json.response !== "string") {
    throw new Error("Ollama response missing 'response' string");
  }
  return cleanupExtractedText(json.response);
}

export async function runTextOcr(
  extractedText: string,
  model?: string,
  baseUrl = config.OLLAMA_URL,
  signal?: AbortSignal,
  // num_predict counts thinking tokens too, and hitting the cap does not fail
  // the request — it returns a JSON object cut off mid-value, which is where
  // "Unexpected end of JSON input" came from. The grammar already bounds how
  // long the model can ramble (every string field carries maxLength: 80), so
  // the cap only has to cover the object itself plus any thinking: ~1.5k is
  // comfortable for a plain model. Reasoning models can burn well over 1k
  // tokens thinking before the first brace and get VERIFY_NUM_PREDICT instead.
  numPredict = 1536,
): Promise<{ rawText: string; model: string }> {
  // Stage 2 has its own model. It used to fall through to OLLAMA_VISION_MODEL,
  // which is how the parse stage came to be governed by the vision setting.
  const resolvedModel = model ?? config.OLLAMA_PARSE_MODEL;
  if (!resolvedModel) throw new Error("No parse model configured (OLLAMA_PARSE_MODEL)");
  const body = {
    model: resolvedModel,
    prompt: buildTextParsePrompt(extractedText),
    format: OCR_FORMAT_SCHEMA,
    stream: false,
    keep_alive: "10m",
    options: { num_predict: numPredict },
  };

  const res = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(config.OCR_TIMEOUT_MS),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Ollama returned ${res.status}: ${txt.slice(0, 500)}`);
  }

  const json = (await res.json()) as OllamaGenerateResponse;
  if (typeof json.response !== "string") {
    throw new Error("Ollama response missing 'response' string");
  }
  return { rawText: json.response, model: json.model ?? resolvedModel };
}
