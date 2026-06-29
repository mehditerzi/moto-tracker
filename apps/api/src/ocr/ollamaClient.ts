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
const N = (t: "string" | "integer" | "number") =>
  ({ anyOf: [{ type: t }, { type: "null" }] }) as const;

const OCR_FORMAT_SCHEMA = {
  type: "object",
  properties: {
    doc_type: { type: "string", enum: ["ruhsat", "sigorta", "kasko", "muayene", "unknown"] },
    plate: N("string"),
    make: N("string"),
    model: N("string"),
    year: N("integer"),
    color: N("string"),
    chassis_no: N("string"),
    engine_no: N("string"),
    cylinder_cc: N("integer"),
    dates: {
      type: "object",
      properties: {
        sigorta_expires_on: N("string"),
        kasko_expires_on: N("string"),
        muayene_expires_on: N("string"),
      },
      required: ["sigorta_expires_on", "kasko_expires_on", "muayene_expires_on"],
    },
    confidence: { type: "number" },
  },
  required: [
    "doc_type", "plate", "make", "model", "year", "color",
    "chassis_no", "engine_no", "cylinder_cc", "dates", "confidence",
  ],
};

export async function runVisionOcr(
  imagePath: string,
  model = config.OLLAMA_VISION_MODEL,
  baseUrl = config.OLLAMA_URL,
  signal?: AbortSignal,
): Promise<{ rawText: string; model: string }> {
  const buf = await fs.readFile(imagePath);
  const base64 = buf.toString("base64");

  const body = {
    model,
    prompt: `${OCR_SYSTEM_PROMPT}\n\n${buildUserPrompt()}`,
    images: [base64],
    format: OCR_FORMAT_SCHEMA,
    stream: false,
    keep_alive: "10m",
    options: { num_predict: 1024 },
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

export async function runTextOcr(
  extractedText: string,
  model?: string,
  baseUrl = config.OLLAMA_URL,
  signal?: AbortSignal,
): Promise<{ rawText: string; model: string }> {
  const resolvedModel = model ?? config.OLLAMA_PARSE_MODEL ?? config.OLLAMA_VISION_MODEL;
  const body = {
    model: resolvedModel,
    prompt: buildTextParsePrompt(extractedText),
    format: OCR_FORMAT_SCHEMA,
    stream: false,
    keep_alive: "10m",
    options: { num_predict: 1024 },
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
