import fs from "node:fs/promises";
import { config } from "../config.js";
import { OCR_SYSTEM_PROMPT, buildUserPrompt, buildTextParsePrompt } from "./prompt.js";

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
}

// Ollama structured-output schema (draft-07). Pins exact field names so the
// model can't invent its own keys. Nullable fields omit "null" type because
// Ollama/llama.cpp JSON grammar doesn't always support type arrays; the Zod
// parser already coerces missing/null fields to null with .default(null).
const OCR_FORMAT_SCHEMA = {
  type: "object",
  properties: {
    doc_type: { type: "string", enum: ["ruhsat", "sigorta", "kasko", "muayene", "unknown"] },
    plate: { type: "string" },
    make: { type: "string" },
    model: { type: "string" },
    year: { type: "integer" },
    chassis_no: { type: "string" },
    engine_no: { type: "string" },
    cylinder_cc: { type: "integer" },
    dates: {
      type: "object",
      properties: {
        sigorta_expires_on: { type: "string" },
        kasko_expires_on: { type: "string" },
        muayene_expires_on: { type: "string" },
      },
    },
    confidence: { type: "number" },
  },
  required: ["doc_type", "confidence"],
};

export async function runVisionOcr(
  imagePath: string,
  model = config.OLLAMA_VISION_MODEL,
  baseUrl = config.OLLAMA_URL,
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
