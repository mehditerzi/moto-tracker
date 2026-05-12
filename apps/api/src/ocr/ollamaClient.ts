import fs from "node:fs/promises";
import { config } from "../config.js";
import { OCR_SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
}

export async function runVisionOcr(
  imagePath: string,
  model = config.OLLAMA_VISION_MODEL,
  baseUrl = config.OLLAMA_URL,
): Promise<{ rawText: string; model: string }> {
  const buf = await fs.readFile(imagePath);
  const base64 = buf.toString("base64");

  // Single-pass: the prompt schema has visible_text as the first field so the
  // model dumps all visible characters before filling structured fields — same
  // quality benefit as a two-pass approach at half the latency.
  // We deliberately do NOT pass `format: "json"` — Ollama's strict JSON mode
  // returns an empty response on some vision models (notably Qwen). The prompt
  // asks for JSON-only output, and the parser tolerates prose-wrapped JSON.
  const body = {
    model,
    prompt: `${OCR_SYSTEM_PROMPT}\n\n${buildUserPrompt()}`,
    images: [base64],
    stream: false,
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
