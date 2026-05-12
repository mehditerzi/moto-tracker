import fs from "node:fs/promises";
import { config } from "../config.js";
import { OCR_SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
}

async function extractRawText(
  base64: string,
  model: string,
  baseUrl: string,
): Promise<string> {
  try {
    const body = {
      model,
      prompt:
        "Bu görseldeki TÜM metni aynen yaz. Her kelimeyi, tarihi, plakayı, sayıyı eksiksiz listele. Sadece görünen metni yaz, yorum ekleme.",
      images: [base64],
      stream: false,
    };

    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return "";
    }

    const json = (await res.json()) as OllamaGenerateResponse;
    return typeof json.response === "string" ? json.response : "";
  } catch {
    return "";
  }
}

export async function runVisionOcr(
  imagePath: string,
  model = config.OLLAMA_VISION_MODEL,
  baseUrl = config.OLLAMA_URL,
): Promise<{ rawText: string; model: string }> {
  const buf = await fs.readFile(imagePath);
  const base64 = buf.toString("base64");

  // Pass 1 — raw text dump: extract all visible text from the image.
  // Errors are caught inside extractRawText; defaults to empty string.
  const extractedText = await extractRawText(base64, model, baseUrl);

  // Pass 2 — structured extraction.
  // We deliberately do NOT pass `format: "json"` — Ollama's strict JSON mode
  // returns an empty response on some vision models (notably Qwen). The prompt
  // asks for JSON-only output, and the parser tolerates prose-wrapped JSON.
  const body = {
    model,
    prompt: `${OCR_SYSTEM_PROMPT}\n\n${buildUserPrompt(extractedText)}`,
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
