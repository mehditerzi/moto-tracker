# MotoTracker — Phase 3: OCR Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Photograph a document (ruhsat / sigorta poliçesi / muayene belgesi). The API stores the file, calls a local Ollama vision model, parses the JSON, and — when confidence is high enough — auto-creates the matching `dated_item` record. The web app exposes a camera-driven capture flow with a scan-line animation while processing and a confirmation sheet for low-confidence fields.

**Architecture:** Add `document` table. Add `multer` upload + on-disk storage. Add an in-process OCR worker (concurrency 1) that calls Ollama via fetch and updates the document row. Add the capture/review web UI. The worker is deterministic and pure given a stubbable `runVisionOcr` function — tests mock that boundary, not Ollama itself.

**Tech stack additions:** `multer`, `sharp`, `@types/multer`. Web adds nothing — uses existing fetch. No new runtime dep on Ollama (we call it via plain fetch).

**Spec:** `docs/superpowers/specs/2026-05-08-mototracker-design.md` §4

---

## File Structure (created/modified)

Created:

```
apps/api/src/db/migrations/003_document.sql
apps/api/src/ocr/
  ollamaClient.ts            # runVisionOcr(imagePath, model) -> raw text
  prompt.ts                  # OCR_SYSTEM_PROMPT (Turkish-aware) + buildUserPrompt
  parser.ts                  # zod schema + parse(rawText) -> normalized result
  autoApply.ts               # given parsed result + bike, decide whether to insert dated_item
  worker.ts                  # async queue (concurrency 1); processDocument(id)
apps/api/src/routes/documents.ts
apps/api/tests/ocr.parser.test.ts
apps/api/tests/documents.test.ts

packages/shared/src/schemas/document.ts

apps/web/src/hooks/useDocuments.ts
apps/web/src/components/CaptureFab.tsx
apps/web/src/pages/DocumentCapturePage.tsx
apps/web/src/pages/DocumentReviewPage.tsx
```

Modified:

```
apps/api/src/config.ts          # UPLOADS_DIR, OLLAMA_URL, OLLAMA_VISION_MODEL, OCR_AUTO_APPLY_THRESHOLD
apps/api/src/server.ts          # mount /api/documents
apps/api/package.json           # multer, sharp, @types/multer
apps/api/.env.example           # new envs
docker-compose.yml              # OLLAMA_URL=http://ollama:11434 in api service env
.env.example                    # OLLAMA_VISION_MODEL hint

packages/shared/src/index.ts    # re-export document schemas

apps/web/src/routes.tsx         # /capture and /documents/:id/review
apps/web/src/pages/DashboardPage.tsx    # add CaptureFab
```

---

## Task 1: DB migration for `document` table

**Files:** Create `apps/api/src/db/migrations/003_document.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE IF NOT EXISTS document (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  bike_id TEXT REFERENCES bike(id) ON DELETE SET NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  doc_type TEXT CHECK (doc_type IN ('ruhsat','sigorta','kasko','muayene','unknown')),
  ocr_raw_json TEXT,
  ocr_extracted_json TEXT,
  ocr_status TEXT NOT NULL DEFAULT 'pending' CHECK (ocr_status IN ('pending','done','failed')),
  ocr_model TEXT,
  ocr_error TEXT,
  applied_dated_item_id TEXT REFERENCES dated_item(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_doc_user ON document(user_id, ocr_status);
CREATE INDEX IF NOT EXISTS idx_doc_bike ON document(bike_id);
```

- [ ] **Step 2: Apply + commit**

```bash
pnpm --filter @mototracker/api migrate
git add apps/api/src/db/migrations/003_document.sql
git commit -m "feat(api): migration for document table"
```

---

## Task 2: Shared zod schemas for documents

**Files:** Create `packages/shared/src/schemas/document.ts`; modify `packages/shared/src/index.ts`.

- [ ] **Step 1: Write packages/shared/src/schemas/document.ts**

```ts
import { z } from "zod";

export const docTypeSchema = z.enum(["ruhsat", "sigorta", "kasko", "muayene", "unknown"]);
export type DocType = z.infer<typeof docTypeSchema>;

export const ocrStatusSchema = z.enum(["pending", "done", "failed"]);
export type OcrStatus = z.infer<typeof ocrStatusSchema>;

export const ocrExtractedSchema = z.object({
  docType: docTypeSchema,
  plate: z.string().nullable(),
  dates: z.object({
    sigortaExpiresOn: z.string().nullable(),
    kaskoExpiresOn: z.string().nullable(),
    muayeneExpiresOn: z.string().nullable(),
  }),
  confidence: z.number().min(0).max(1),
});
export type OcrExtracted = z.infer<typeof ocrExtractedSchema>;

export const documentSchema = z.object({
  id: z.string(),
  userId: z.string(),
  bikeId: z.string().nullable(),
  filePath: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  docType: docTypeSchema.nullable(),
  ocrExtracted: ocrExtractedSchema.nullable(),
  ocrStatus: ocrStatusSchema,
  ocrModel: z.string().nullable(),
  ocrError: z.string().nullable(),
  appliedDatedItemId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Document = z.infer<typeof documentSchema>;
```

- [ ] **Step 2: Append to packages/shared/src/index.ts**

```ts
export * from "./schemas/document";
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @mototracker/shared run build
git add packages/shared
git commit -m "feat(shared): zod schemas for document and ocr extracted result"
```

---

## Task 3: Config additions

**Files:** Modify `apps/api/src/config.ts`, `apps/api/.env.example`.

- [ ] **Step 1: Edit apps/api/src/config.ts**

Find the `Env = z.object({...})` definition and add four fields. The full updated `Env`:

```ts
const Env = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_PATH: z.string().default("./data/app.db"),
  WEB_ORIGIN: z.string().url(),
  SESSION_SECRET: z.string().min(16),
  APP_BASE_URL: z.string().url(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("MotoTracker <noreply@example.com>"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  UPLOADS_DIR: z.string().default("./data/uploads"),
  OLLAMA_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_VISION_MODEL: z.string().default("gemma3:4b"),
  OCR_AUTO_APPLY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
});
```

In the same file, the test-mode `loadConfig({...})` call needs `UPLOADS_DIR: "/tmp/mototracker-test-uploads"` added (so tests don't write to `./data/uploads`). Add it inside the test-config object.

- [ ] **Step 2: Update apps/api/.env.example**

Append:

```env

# OCR
UPLOADS_DIR=./data/uploads
OLLAMA_URL=http://localhost:11434
OLLAMA_VISION_MODEL=gemma3:4b
OCR_AUTO_APPLY_THRESHOLD=0.7
```

- [ ] **Step 3: Verify**

```bash
pnpm --filter @mototracker/api test
```

Expected: still 19 tests passing.

- [ ] **Step 4: Commit**

```bash
git add apps/api
git commit -m "chore(api): config for uploads dir, ollama url, vision model, threshold"
```

---

## Task 4: OCR `parser.ts` (zod schema + normalization) — pure, easy to test

**Files:** Create `apps/api/src/ocr/parser.ts`, `apps/api/tests/ocr.parser.test.ts`.

- [ ] **Step 1: Write apps/api/src/ocr/parser.ts**

```ts
import { z } from "zod";

/**
 * Schema for the JSON object Ollama is asked to produce. Keys are snake_case in the
 * model's output to match the prompt; we normalize to camelCase for the rest of the app.
 */
const RawSchema = z.object({
  doc_type: z.enum(["ruhsat", "sigorta", "kasko", "muayene", "unknown"]).default("unknown"),
  plate: z
    .union([z.string(), z.null()])
    .transform((v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null)),
  dates: z
    .object({
      sigorta_expires_on: z.union([z.string(), z.null()]).optional(),
      kasko_expires_on: z.union([z.string(), z.null()]).optional(),
      muayene_expires_on: z.union([z.string(), z.null()]).optional(),
    })
    .default({}),
  confidence: z.coerce.number().min(0).max(1).default(0),
});

export interface ParsedOcr {
  docType: "ruhsat" | "sigorta" | "kasko" | "muayene" | "unknown";
  plate: string | null;
  dates: {
    sigortaExpiresOn: string | null;
    kaskoExpiresOn: string | null;
    muayeneExpiresOn: string | null;
  };
  confidence: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  if (ISO_DATE.test(t)) return t;
  // Accept dd/mm/yyyy and dd.mm.yyyy as common Turkish formats.
  const m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  }
  return null;
}

/**
 * Parse the model's response text. Accepts either a JSON object string or a string with
 * leading/trailing prose that contains a JSON object — finds the first `{...}` block.
 * Throws if no usable JSON can be parsed.
 */
export function parseOcr(rawText: string): ParsedOcr {
  let jsonText = rawText.trim();
  if (jsonText.startsWith("```")) {
    // strip a markdown code fence if the model wraps the JSON
    jsonText = jsonText.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  }
  if (!jsonText.startsWith("{")) {
    const start = jsonText.indexOf("{");
    const end = jsonText.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("OCR response did not contain a JSON object");
    }
    jsonText = jsonText.slice(start, end + 1);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`OCR response was not valid JSON: ${(e as Error).message}`);
  }

  const parsed = RawSchema.parse(raw);
  return {
    docType: parsed.doc_type,
    plate: parsed.plate,
    dates: {
      sigortaExpiresOn: normalizeDate(parsed.dates.sigorta_expires_on),
      kaskoExpiresOn: normalizeDate(parsed.dates.kasko_expires_on),
      muayeneExpiresOn: normalizeDate(parsed.dates.muayene_expires_on),
    },
    confidence: parsed.confidence,
  };
}
```

- [ ] **Step 2: Write apps/api/tests/ocr.parser.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { parseOcr } from "../src/ocr/parser.js";

describe("parseOcr", () => {
  it("parses a clean JSON response", () => {
    const r = parseOcr(
      JSON.stringify({
        doc_type: "sigorta",
        plate: "34 ABC 123",
        dates: { sigorta_expires_on: "2027-06-01" },
        confidence: 0.92,
      }),
    );
    expect(r.docType).toBe("sigorta");
    expect(r.plate).toBe("34 ABC 123");
    expect(r.dates.sigortaExpiresOn).toBe("2027-06-01");
    expect(r.dates.kaskoExpiresOn).toBeNull();
    expect(r.confidence).toBeCloseTo(0.92);
  });

  it("normalizes Turkish date formats", () => {
    const r = parseOcr(
      JSON.stringify({
        doc_type: "muayene",
        plate: null,
        dates: { muayene_expires_on: "01.06.2027" },
        confidence: 0.8,
      }),
    );
    expect(r.dates.muayeneExpiresOn).toBe("2027-06-01");
  });

  it("strips a markdown code fence", () => {
    const r = parseOcr("```json\n" + JSON.stringify({ doc_type: "kasko", plate: "x", dates: {}, confidence: 0.5 }) + "\n```");
    expect(r.docType).toBe("kasko");
  });

  it("extracts JSON from surrounding prose", () => {
    const r = parseOcr(
      "Belgeye baktım. {\"doc_type\":\"sigorta\",\"plate\":\"34X\",\"dates\":{\"sigorta_expires_on\":\"2026-12-31\"},\"confidence\":0.7} (kesin değil)",
    );
    expect(r.dates.sigortaExpiresOn).toBe("2026-12-31");
  });

  it("throws when no JSON object is present", () => {
    expect(() => parseOcr("hiçbir şey yok")).toThrow();
  });

  it("defaults docType to 'unknown' and confidence to 0 when missing", () => {
    const r = parseOcr("{}");
    expect(r.docType).toBe("unknown");
    expect(r.confidence).toBe(0);
  });

  it("treats blank plate as null", () => {
    const r = parseOcr(JSON.stringify({ doc_type: "ruhsat", plate: "   ", dates: {}, confidence: 0.4 }));
    expect(r.plate).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests + commit**

```bash
pnpm --filter @mototracker/api test
git add apps/api
git commit -m "feat(api): OCR JSON parser with Turkish date normalization + tests"
```

---

## Task 5: OCR `prompt.ts` and `ollamaClient.ts`

**Files:** Create `apps/api/src/ocr/prompt.ts`, `apps/api/src/ocr/ollamaClient.ts`.

- [ ] **Step 1: Write apps/api/src/ocr/prompt.ts**

```ts
export const OCR_SYSTEM_PROMPT = `Sen bir Türk araç belgesi OCR asistanısın. Bir fotoğraf vereceğim; içindeki:
- belge türünü (doc_type),
- plakayı (plate),
- ve ilgili bitiş/sonu tarihlerini (dates)
çıkar. SADECE aşağıdaki JSON şemasında yanıt ver. Açıklama, yorum veya kod bloğu ekleme.

doc_type değerleri: "ruhsat" | "sigorta" | "kasko" | "muayene" | "unknown".
Tarihler ISO 8601 (YYYY-MM-DD) formatında olmalı; bilinmeyen alanlar null olmalı.
confidence 0.0 ile 1.0 arasında bir sayı.

Şema:
{
  "doc_type": "<one_of_above>",
  "plate": "<plaka veya null>",
  "dates": {
    "sigorta_expires_on": "YYYY-MM-DD veya null",
    "kasko_expires_on": "YYYY-MM-DD veya null",
    "muayene_expires_on": "YYYY-MM-DD veya null"
  },
  "confidence": 0.0
}`;

export function buildUserPrompt(): string {
  return "Bu fotoğrafı incele ve şemaya göre JSON döndür.";
}
```

- [ ] **Step 2: Write apps/api/src/ocr/ollamaClient.ts**

```ts
import fs from "node:fs/promises";
import { config } from "../config.js";
import { OCR_SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
}

/**
 * Calls Ollama's /api/generate with a vision model and returns the raw `response` string.
 * Throws on network or non-2xx error. Does not attempt to parse the response.
 */
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
    format: "json" as const,
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
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/ocr
git commit -m "feat(api): ollama vision client + OCR prompt"
```

---

## Task 6: OCR `autoApply.ts`

**Files:** Create `apps/api/src/ocr/autoApply.ts`.

- [ ] **Step 1: Write the file**

```ts
import type Database from "better-sqlite3";
import { newId } from "../lib/ulid.js";
import type { ParsedOcr } from "./parser.js";

export interface AutoApplyInput {
  db: Database.Database;
  userId: string;
  documentId: string;
  /** May be null when the user uploaded without selecting a bike. */
  bikeIdHint: string | null;
  parsed: ParsedOcr;
  threshold: number;
}

export interface AutoApplyOutput {
  appliedDatedItemId: string | null;
  reason:
    | "applied"
    | "low_confidence"
    | "doc_type_not_dated"
    | "no_matching_date"
    | "no_bike_match";
}

interface BikeRow {
  id: string;
  plate: string | null;
}

function normalizePlate(p: string | null | undefined): string | null {
  if (!p) return null;
  return p.replace(/\s+/g, "").toUpperCase();
}

function pickBikeId(
  db: Database.Database,
  userId: string,
  bikeIdHint: string | null,
  plate: string | null,
): string | null {
  if (bikeIdHint) {
    const r = db
      .prepare("SELECT id FROM bike WHERE id = ? AND user_id = ? AND archived = 0")
      .get(bikeIdHint, userId) as { id: string } | undefined;
    if (r) return r.id;
  }
  const np = normalizePlate(plate);
  if (np) {
    const rows = db
      .prepare("SELECT id, plate FROM bike WHERE user_id = ? AND archived = 0")
      .all(userId) as BikeRow[];
    for (const b of rows) {
      if (normalizePlate(b.plate) === np) return b.id;
    }
  }
  // Single-bike user fallback.
  const all = db
    .prepare("SELECT id FROM bike WHERE user_id = ? AND archived = 0")
    .all(userId) as { id: string }[];
  if (all.length === 1) return all[0]!.id;
  return null;
}

const TYPE_TO_KEY = {
  sigorta: "sigortaExpiresOn",
  kasko: "kaskoExpiresOn",
  muayene: "muayeneExpiresOn",
} as const;

export function autoApply(input: AutoApplyInput): AutoApplyOutput {
  const { db, userId, documentId, bikeIdHint, parsed, threshold } = input;

  if (parsed.docType === "ruhsat" || parsed.docType === "unknown") {
    return { appliedDatedItemId: null, reason: "doc_type_not_dated" };
  }
  if (parsed.confidence < threshold) {
    return { appliedDatedItemId: null, reason: "low_confidence" };
  }

  const dateKey = TYPE_TO_KEY[parsed.docType];
  const expiresOn = parsed.dates[dateKey];
  if (!expiresOn) {
    return { appliedDatedItemId: null, reason: "no_matching_date" };
  }

  const bikeId = pickBikeId(db, userId, bikeIdHint, parsed.plate);
  if (!bikeId) {
    return { appliedDatedItemId: null, reason: "no_bike_match" };
  }

  const id = newId();
  db.prepare(
    `INSERT INTO dated_item
       (id, bike_id, user_id, type, expires_on, source_document_id, ocr_confidence, needs_review)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(id, bikeId, userId, parsed.docType, expiresOn, documentId, parsed.confidence);
  return { appliedDatedItemId: id, reason: "applied" };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/ocr/autoApply.ts
git commit -m "feat(api): auto-apply OCR result to dated_item when confident"
```

---

## Task 7: OCR `worker.ts`

**Files:** Create `apps/api/src/ocr/worker.ts`.

- [ ] **Step 1: Write the file**

```ts
import { getDb } from "../db/index.js";
import { config } from "../config.js";
import { runVisionOcr as runVisionOcrDefault } from "./ollamaClient.js";
import { parseOcr } from "./parser.js";
import { autoApply } from "./autoApply.js";

interface DocRow {
  id: string;
  user_id: string;
  bike_id: string | null;
  file_path: string;
}

type RunVisionOcr = typeof runVisionOcrDefault;

/**
 * Test seam: replace the OCR call without monkey-patching fetch.
 */
let _runVisionOcr: RunVisionOcr = runVisionOcrDefault;
export function __setRunVisionOcrForTests(impl: RunVisionOcr): void {
  _runVisionOcr = impl;
}
export function __resetRunVisionOcrForTests(): void {
  _runVisionOcr = runVisionOcrDefault;
}

let _running = Promise.resolve();

/**
 * Single-flight queue: ensures only one OCR call runs at a time, since Ollama on a
 * single GPU/CPU is not safe to call in parallel. Returns a promise that resolves
 * AFTER the document has been processed (mostly used in tests).
 */
export function enqueueDocument(documentId: string): Promise<void> {
  const next = _running.then(() => processDocument(documentId).catch((e) => {
    // Errors are already recorded in the document row by processDocument; swallow here.
    console.error(`[ocr] document ${documentId} failed:`, e);
  }));
  _running = next;
  return next;
}

export async function processDocument(documentId: string): Promise<void> {
  const db = getDb();
  const doc = db
    .prepare("SELECT id, user_id, bike_id, file_path FROM document WHERE id = ?")
    .get(documentId) as DocRow | undefined;
  if (!doc) return;

  try {
    const { rawText, model } = await _runVisionOcr(doc.file_path);
    const parsed = parseOcr(rawText);

    const apply = autoApply({
      db,
      userId: doc.user_id,
      documentId: doc.id,
      bikeIdHint: doc.bike_id,
      parsed,
      threshold: config.OCR_AUTO_APPLY_THRESHOLD,
    });

    db.prepare(
      `UPDATE document
         SET ocr_status = 'done',
             ocr_raw_json = ?,
             ocr_extracted_json = ?,
             doc_type = ?,
             ocr_model = ?,
             applied_dated_item_id = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
    ).run(
      rawText,
      JSON.stringify(parsed),
      parsed.docType,
      model,
      apply.appliedDatedItemId,
      doc.id,
    );
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    db.prepare(
      `UPDATE document
         SET ocr_status = 'failed',
             ocr_error = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
    ).run(msg, doc.id);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/ocr/worker.ts
git commit -m "feat(api): OCR worker with single-flight queue and test seam"
```

---

## Task 8: Document upload routes

**Files:** Create `apps/api/src/routes/documents.ts`; modify `apps/api/src/server.ts`, `apps/api/package.json`.

- [ ] **Step 1: Add deps**

```bash
pnpm --filter @mototracker/api add multer sharp
pnpm --filter @mototracker/api add -D @types/multer
```

- [ ] **Step 2: Write apps/api/src/routes/documents.ts**

```ts
import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { config } from "../config.js";
import { enqueueDocument } from "../ocr/worker.js";

interface DocRow {
  id: string;
  user_id: string;
  bike_id: string | null;
  file_path: string;
  mime_type: string;
  size_bytes: number;
  doc_type: string | null;
  ocr_raw_json: string | null;
  ocr_extracted_json: string | null;
  ocr_status: "pending" | "done" | "failed";
  ocr_model: string | null;
  ocr_error: string | null;
  applied_dated_item_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToDocument(r: DocRow) {
  return {
    id: r.id,
    userId: r.user_id,
    bikeId: r.bike_id,
    filePath: r.file_path,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    docType: r.doc_type as
      | "ruhsat"
      | "sigorta"
      | "kasko"
      | "muayene"
      | "unknown"
      | null,
    ocrExtracted: r.ocr_extracted_json ? JSON.parse(r.ocr_extracted_json) : null,
    ocrStatus: r.ocr_status,
    ocrModel: r.ocr_model,
    ocrError: r.ocr_error,
    appliedDatedItemId: r.applied_dated_item_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)) {
      cb(new Error("Yalnızca jpeg / png / webp / heic kabul ediliyor"));
      return;
    }
    cb(null, true);
  },
});

export const documentsRouter: Router = Router();
documentsRouter.use(requireUser);

documentsRouter.post(
  "/",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "file_required" });
      return;
    }
    const bikeId = typeof req.query.bikeId === "string" ? req.query.bikeId : null;
    if (bikeId) {
      const db = getDb();
      const exists = db
        .prepare("SELECT id FROM bike WHERE id = ? AND user_id = ?")
        .get(bikeId, req.user!.id);
      if (!exists) {
        res.status(404).json({ error: "bike_not_found" });
        return;
      }
    }

    const id = newId();
    const userDir = path.join(config.UPLOADS_DIR, req.user!.id);
    await fs.mkdir(userDir, { recursive: true });
    const outPath = path.join(userDir, `${id}.jpg`);

    // Re-encode + downscale to keep things small and predictable.
    const buf = await sharp(req.file.buffer)
      .rotate()                          // honour EXIF orientation
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    await fs.writeFile(outPath, buf);

    const db = getDb();
    db.prepare(
      `INSERT INTO document (id, user_id, bike_id, file_path, mime_type, size_bytes, ocr_status)
       VALUES (?, ?, ?, ?, 'image/jpeg', ?, 'pending')`,
    ).run(id, req.user!.id, bikeId, outPath, buf.length);

    // Kick off OCR; do not await.
    void enqueueDocument(id);

    const row = db.prepare("SELECT * FROM document WHERE id = ?").get(id) as DocRow;
    res.status(201).json(rowToDocument(row));
  }),
);

documentsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM document WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id) as DocRow | undefined;
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(rowToDocument(row));
  }),
);

documentsRouter.get(
  "/:id/file",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db
      .prepare("SELECT id, user_id, file_path, mime_type FROM document WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id) as
      | { id: string; user_id: string; file_path: string; mime_type: string }
      | undefined;
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.setHeader("Content-Type", row.mime_type);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.sendFile(path.resolve(row.file_path));
  }),
);
```

- [ ] **Step 3: Modify apps/api/src/server.ts**

Add import:

```ts
import { documentsRouter } from "./routes/documents.js";
```

After `app.use("/api/dashboard", dashboardRouter);` add:

```ts
  app.use("/api/documents", documentsRouter);
```

- [ ] **Step 4: Commit**

```bash
git add apps/api
git commit -m "feat(api): document upload + status endpoints; multer + sharp pipeline"
```

---

## Task 9: API tests for documents (with stubbed OCR)

**Files:** Create `apps/api/tests/documents.test.ts`.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";
import {
  __setRunVisionOcrForTests,
  __resetRunVisionOcrForTests,
} from "../src/ocr/worker.js";

async function makeJpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .jpeg()
    .toBuffer();
}

async function createBike(app: ReturnType<typeof buildTestApp>, cookie: string, plate?: string) {
  const res = await request(app)
    .post("/api/bikes")
    .set("Cookie", cookie)
    .set("Content-Type", "application/json")
    .send({ nickname: "B1", plate: plate ?? null });
  return res.body.id as string;
}

async function waitForDoc(
  app: ReturnType<typeof buildTestApp>,
  cookie: string,
  id: string,
  timeoutMs = 5000,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request(app).get(`/api/documents/${id}`).set("Cookie", cookie);
    if (res.body.ocrStatus !== "pending") return res.body;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("OCR did not finish in time");
}

describe("/api/documents", () => {
  afterEach(() => {
    __resetRunVisionOcrForTests();
    // best-effort cleanup of test upload dir
    void fs.rm("/tmp/mototracker-test-uploads", { recursive: true, force: true });
  });

  it("requires auth", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/documents");
    expect(res.status).toBe(401);
  });

  it("uploads, runs OCR (stubbed), auto-applies a sigorta dated_item", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bikeId = await createBike(app, cookie, "34 ABC 123");

    __setRunVisionOcrForTests(async () => ({
      rawText: JSON.stringify({
        doc_type: "sigorta",
        plate: "34 ABC 123",
        dates: { sigorta_expires_on: "2027-06-01" },
        confidence: 0.9,
      }),
      model: "test-model",
    }));

    const buf = await makeJpeg();
    const post = await request(app)
      .post("/api/documents")
      .set("Cookie", cookie)
      .attach("file", buf, { filename: "test.jpg", contentType: "image/jpeg" });
    expect(post.status).toBe(201);
    expect(post.body.ocrStatus).toBe("pending");

    const finished = await waitForDoc(app, cookie, post.body.id);
    expect(finished.ocrStatus).toBe("done");
    expect(finished.docType).toBe("sigorta");
    expect(finished.appliedDatedItemId).toBeTruthy();

    // and it shows up on dashboard
    const dash = await request(app).get("/api/dashboard").set("Cookie", cookie);
    expect(dash.body[0].items.sigorta.expiresOn).toBe("2027-06-01");
    expect(dash.body[0].bike.id).toBe(bikeId);
  });

  it("does NOT auto-apply when confidence is below threshold", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    await createBike(app, cookie, "34 ABC 123");

    __setRunVisionOcrForTests(async () => ({
      rawText: JSON.stringify({
        doc_type: "sigorta",
        plate: "34 ABC 123",
        dates: { sigorta_expires_on: "2027-06-01" },
        confidence: 0.4,
      }),
      model: "test-model",
    }));

    const post = await request(app)
      .post("/api/documents")
      .set("Cookie", cookie)
      .attach("file", await makeJpeg(), { filename: "x.jpg", contentType: "image/jpeg" });

    const finished = await waitForDoc(app, cookie, post.body.id);
    expect(finished.ocrStatus).toBe("done");
    expect(finished.appliedDatedItemId).toBeNull();
  });

  it("marks failed when OCR throws", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    await createBike(app, cookie);

    __setRunVisionOcrForTests(async () => {
      throw new Error("ollama unreachable");
    });

    const post = await request(app)
      .post("/api/documents")
      .set("Cookie", cookie)
      .attach("file", await makeJpeg(), { filename: "x.jpg", contentType: "image/jpeg" });
    const finished = await waitForDoc(app, cookie, post.body.id);
    expect(finished.ocrStatus).toBe("failed");
    expect(finished.ocrError).toMatch(/ollama unreachable/);
  });

  it("rejects non-image uploads", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app)
      .post("/api/documents")
      .set("Cookie", cookie)
      .attach("file", Buffer.from("not an image"), {
        filename: "x.txt",
        contentType: "text/plain",
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("does not return another user's document", async () => {
    const app = buildTestApp();
    const u1 = await signUpAndSignIn(app, "alice@test.com");
    const u2 = await signUpAndSignIn(app, "bob@test.com");
    __setRunVisionOcrForTests(async () => ({
      rawText: '{"doc_type":"unknown","plate":null,"dates":{},"confidence":0}',
      model: "x",
    }));
    const post = await request(app)
      .post("/api/documents")
      .set("Cookie", u1.cookie)
      .attach("file", await makeJpeg(), { filename: "x.jpg", contentType: "image/jpeg" });
    const cross = await request(app).get(`/api/documents/${post.body.id}`).set("Cookie", u2.cookie);
    expect(cross.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter @mototracker/api test
git add apps/api
git commit -m "test(api): document upload + OCR pipeline (stubbed Ollama)"
```

Expected: 19 prior + 7 new parser + 5 new documents = 31 passing.

---

## Task 10: Web — `useDocuments` hook + upload helper

**Files:** Create `apps/web/src/hooks/useDocuments.ts`.

- [ ] **Step 1: Write apps/web/src/hooks/useDocuments.ts**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { env } from "@/env";
import type { Document } from "@mototracker/shared";

export function useDocument(id: string | undefined, opts?: { pollWhilePending?: boolean }) {
  return useQuery<Document>({
    queryKey: ["document", id],
    queryFn: () => api<Document>(`/api/documents/${id}`),
    enabled: !!id,
    refetchInterval: (q) => {
      if (!opts?.pollWhilePending) return false;
      const data = q.state.data as Document | undefined;
      return data && data.ocrStatus === "pending" ? 1500 : false;
    },
  });
}

export interface UploadDocumentInput {
  file: File;
  bikeId?: string;
}

async function uploadDocument(input: UploadDocumentInput): Promise<Document> {
  const fd = new FormData();
  fd.append("file", input.file);
  const url = new URL(`${env.VITE_API_URL}/api/documents`);
  if (input.bikeId) url.searchParams.set("bikeId", input.bikeId);
  const res = await fetch(url.toString(), {
    method: "POST",
    body: fd,
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Upload failed (${res.status})`);
  }
  return (await res.json()) as Document;
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: uploadDocument,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web
git commit -m "feat(web): document upload + polling hooks"
```

---

## Task 11: Web — `CaptureFab`

**Files:** Create `apps/web/src/components/CaptureFab.tsx`.

- [ ] **Step 1: Write the file**

```tsx
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Camera } from "lucide-react";

interface Props {
  bikeId?: string;
}

export function CaptureFab({ bikeId }: Props) {
  const to = bikeId ? `/capture?bikeId=${bikeId}` : "/capture";
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: "spring", stiffness: 400, damping: 24 }}
      className="fixed bottom-6 right-6 z-40"
    >
      <Link
        to={to}
        aria-label="Belge yükle"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-bg shadow-lg shadow-accent/30 ring-1 ring-black/10"
      >
        <Camera className="h-6 w-6" />
      </Link>
    </motion.div>
  );
}
```

- [ ] **Step 2: Modify `apps/web/src/pages/DashboardPage.tsx`** — add CaptureFab.

At the top imports, add:

```tsx
import { CaptureFab } from "@/components/CaptureFab";
```

In the JSX, immediately before the final closing `</div>` of the outer wrapper of the non-empty branch (i.e., right after the existing `<div className="mt-6 ...">...</div>` that holds the "Motosikletleri yönet" link), add:

```tsx
      <CaptureFab bikeId={active.bike.id} />
```

For the empty-state branch, also add `<CaptureFab />` right after the `<Button asChild ...>` block (so users can capture before creating a bike, though our auto-apply will simply not fire).

- [ ] **Step 3: Skip commit (Task 14 commits dashboard tweaks together with routes wiring).**

---

## Task 12: Web — `DocumentCapturePage`

**Files:** Create `apps/web/src/pages/DocumentCapturePage.tsx`.

- [ ] **Step 1: Write the file**

```tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, Image as ImageIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useUploadDocument } from "@/hooks/useDocuments";
import { pushToast } from "@/hooks/useToast";

export function DocumentCapturePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const bikeId = params.get("bikeId") ?? undefined;
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const galleryInput = useRef<HTMLInputElement | null>(null);
  const upload = useUploadDocument();

  // Revoke object URL on unmount.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function handleFile(file: File) {
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    try {
      const doc = await upload.mutateAsync({ file, bikeId });
      navigate(`/documents/${doc.id}/review`, { replace: true });
    } catch (e) {
      pushToast({
        variant: "danger",
        title: "Yüklenemedi",
        description: (e as Error).message,
      });
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-md"
    >
      <Card>
        <CardHeader>
          <CardTitle>Belge yükle</CardTitle>
          <CardDescription>
            Sigorta poliçesi, kasko poliçesi veya muayene belgenin fotoğrafını çek. Tarihler
            otomatik okunur, eksikleri sen onaylarsın.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AnimatePresence mode="wait">
            {!preview ? (
              <motion.div
                key="picker"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col gap-2"
              >
                <Button
                  type="button"
                  variant="accent"
                  onClick={() => cameraInput.current?.click()}
                >
                  <Camera className="h-4 w-4" /> Kamera ile çek
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => galleryInput.current?.click()}
                >
                  <ImageIcon className="h-4 w-4" /> Galeriden seç
                </Button>
                <input
                  ref={cameraInput}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                  }}
                />
                <input
                  ref={galleryInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                  }}
                />
              </motion.div>
            ) : (
              <motion.div
                key="uploading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col gap-3"
              >
                <div className="relative overflow-hidden rounded-xl border border-border dark:border-border-dark">
                  <img src={preview} alt="" className="block h-64 w-full object-cover" />
                  {busy && (
                    <motion.div
                      initial={{ y: "-100%" }}
                      animate={{ y: "100%" }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
                      className="absolute inset-x-0 h-12 bg-gradient-to-b from-transparent via-accent/40 to-transparent"
                    />
                  )}
                </div>
                <p className="text-center text-sm text-muted dark:text-muted-dark">
                  Yükleniyor ve okunuyor...
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
}
```

- [ ] **Step 2: Skip commit (Task 14 commits all UI together).**

---

## Task 13: Web — `DocumentReviewPage`

**Files:** Create `apps/web/src/pages/DocumentReviewPage.tsx`.

- [ ] **Step 1: Write the file**

```tsx
import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, Pencil, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDocument } from "@/hooks/useDocuments";
import { TYPE_LABEL_TR } from "@/lib/datedItems";
import { env } from "@/env";

export function DocumentReviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const doc = useDocument(id, { pollWhilePending: true });

  useEffect(() => {
    // If the user navigates back here for a finished, auto-applied document,
    // we don't redirect — they can still see what was extracted.
  }, []);

  if (!id) return null;

  if (doc.isLoading || !doc.data) {
    return <p className="text-center text-muted dark:text-muted-dark">Belge yükleniyor...</p>;
  }

  const d = doc.data;
  const fileUrl = `${env.VITE_API_URL}/api/documents/${d.id}/file`;

  if (d.ocrStatus === "pending") {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="mx-auto max-w-md"
      >
        <Card>
          <CardHeader>
            <CardTitle>Belge okunuyor</CardTitle>
            <CardDescription>Bu birkaç saniye sürebilir.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative overflow-hidden rounded-xl border border-border dark:border-border-dark">
              <img src={fileUrl} alt="" className="block h-64 w-full object-cover" />
              <motion.div
                initial={{ y: "-100%" }}
                animate={{ y: "100%" }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
                className="absolute inset-x-0 h-12 bg-gradient-to-b from-transparent via-accent/40 to-transparent"
              />
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  if (d.ocrStatus === "failed") {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-2 text-danger">
                <AlertTriangle className="h-5 w-5" /> Okunamadı
              </span>
            </CardTitle>
            <CardDescription>
              Belgeyi okumayı denedik ama bir şeyler ters gitti.
            </CardDescription>
          </CardHeader>
          <CardContent className="gap-3">
            <p className="text-sm text-muted dark:text-muted-dark">
              {d.ocrError ?? "Bilinmeyen hata."}
            </p>
            <div className="flex gap-2">
              <Button asChild variant="accent" className="flex-1">
                <Link to="/capture">Yeniden dene</Link>
              </Button>
              <Button asChild variant="outline" className="flex-1">
                <Link to="/dashboard">Manuel girişe dön</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  // ocrStatus === "done"
  const ex = d.ocrExtracted;
  const applied = !!d.appliedDatedItemId;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex max-w-md flex-col gap-3"
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <span
              className={
                "inline-flex items-center gap-2 " + (applied ? "text-success" : "")
              }
            >
              {applied ? (
                <>
                  <CheckCircle2 className="h-5 w-5" /> Otomatik kaydedildi
                </>
              ) : (
                <>
                  <Pencil className="h-5 w-5" /> Onayını bekliyor
                </>
              )}
            </span>
          </CardTitle>
          <CardDescription>
            {applied
              ? "Tarihler bulundu ve panonuza eklendi."
              : "Eksik veya düşük güvenli alanlar var. İncele ve elle ekle."}
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-3">
          <div className="overflow-hidden rounded-xl border border-border dark:border-border-dark">
            <img src={fileUrl} alt="" className="block h-56 w-full object-cover" />
          </div>

          {ex && (
            <ul className="grid gap-2">
              <Field label="Belge türü" value={ex.docType} />
              <Field label="Plaka" value={ex.plate} />
              <Field label="Sigorta bitiş" value={ex.dates.sigortaExpiresOn} />
              <Field label="Kasko bitiş" value={ex.dates.kaskoExpiresOn} />
              <Field label="Muayene bitiş" value={ex.dates.muayeneExpiresOn} />
              <Field label="Güven" value={`${Math.round(ex.confidence * 100)}%`} />
            </ul>
          )}

          <div className="flex gap-2">
            {applied && d.appliedDatedItemId ? (
              <Button asChild variant="accent" className="flex-1">
                <Link to={`/dated-items/${d.appliedDatedItemId}`}>Kayda git</Link>
              </Button>
            ) : (
              <Button asChild variant="accent" className="flex-1">
                <Link
                  to={
                    d.bikeId
                      ? `/bikes/${d.bikeId}/dated-items/new?type=${
                          ex?.docType && ex.docType !== "ruhsat" && ex.docType !== "unknown"
                            ? ex.docType
                            : "sigorta"
                        }`
                      : "/dashboard"
                  }
                >
                  Manuel ekle
                </Link>
              </Button>
            )}
            <Button asChild variant="ghost" className="flex-1">
              <Link to="/dashboard"><X className="h-4 w-4" /> Kapat</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <li className="flex items-center justify-between rounded-xl border border-border p-3 text-sm dark:border-border-dark">
      <span className="text-xs uppercase tracking-wider text-muted dark:text-muted-dark">
        {label}
      </span>
      <span className="font-mono">{value ?? <em className="opacity-60">—</em>}</span>
    </li>
  );
}
```

- [ ] **Step 2: Skip commit — Task 14.**

---

## Task 14: Wire routes + commit web UI

**Files:** Modify `apps/web/src/routes.tsx`; commit Tasks 11–13 + DashboardPage tweak together.

- [ ] **Step 1: Modify apps/web/src/routes.tsx**

Add the two imports:

```tsx
import { DocumentCapturePage } from "@/pages/DocumentCapturePage";
import { DocumentReviewPage } from "@/pages/DocumentReviewPage";
```

Inside the protected `children` array, add (after the dated-items routes):

```tsx
      { path: "capture", element: <DocumentCapturePage /> },
      { path: "documents/:id/review", element: <DocumentReviewPage /> },
```

- [ ] **Step 2: Build + commit**

```bash
pnpm --filter @mototracker/web build
git add apps/web
git commit -m "feat(web): document capture + review pages with scanline UX"
```

Expected: build clean.

---

## Task 15: Compose update for OLLAMA_URL

**Files:** Modify `docker-compose.yml`, `.env.example`.

- [ ] **Step 1: Edit docker-compose.yml**

In the `api` service's `environment:` block, add:

```yaml
      OLLAMA_URL: ${OLLAMA_URL:-http://ollama:11434}
      OLLAMA_VISION_MODEL: ${OLLAMA_VISION_MODEL:-gemma3:4b}
      OCR_AUTO_APPLY_THRESHOLD: ${OCR_AUTO_APPLY_THRESHOLD:-0.7}
      UPLOADS_DIR: /data/uploads
```

- [ ] **Step 2: Edit root .env.example**

Append:

```env

# OCR (defaults are fine for the docker-compose stack)
OLLAMA_URL=http://ollama:11434
OLLAMA_VISION_MODEL=gemma3:4b
OCR_AUTO_APPLY_THRESHOLD=0.7
```

- [ ] **Step 3: Validate + commit**

```bash
docker compose -f docker-compose.yml config > /dev/null
git add docker-compose.yml .env.example
git commit -m "chore: thread OCR envs through docker compose"
```

---

## Task 16: End-to-end smoke

- [ ] **Step 1: Reset DB and migrate**

```bash
rm -f apps/api/data/app.db apps/api/data/app.db-*
pnpm --filter @mototracker/api migrate
```

- [ ] **Step 2: Start API and exercise the upload pipeline**

The smoke does NOT require Ollama running. We expect `ocr_status='failed'` when Ollama isn't reachable, since that is the production-realistic fallback path. We're verifying the upload + status pipeline, not the model accuracy.

```bash
pnpm --filter @mototracker/api dev > /tmp/p3-api.log 2>&1 &
sleep 4

COOKIE=/tmp/p3.cookies
rm -f $COOKIE

# sign up
curl -sS -c $COOKIE -X POST http://localhost:8787/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"p3@test.com","password":"supersecret123","name":"P3"}' >/dev/null

BIKE_ID=$(curl -sS -b $COOKIE -X POST http://localhost:8787/api/bikes \
  -H "Content-Type: application/json" \
  -d '{"nickname":"Smoke","plate":"34S001"}' | sed -E 's/.*"id":"([^"]+)".*/\1/')

# Create a 1x1 jpeg with a here-doc using printf — no external deps.
node -e "require('sharp')({create:{width:64,height:64,channels:3,background:{r:200,g:200,b:200}}}).jpeg().toFile('/tmp/test.jpg')" \
  --experimental-vm-modules || true

# fallback if the inline sharp isn't easy
if [ ! -f /tmp/test.jpg ]; then
  curl -sS -o /tmp/test.jpg "https://placehold.co/300x300.jpg"
fi

DOC_ID=$(curl -sS -b $COOKIE -F "file=@/tmp/test.jpg;type=image/jpeg" \
  "http://localhost:8787/api/documents?bikeId=$BIKE_ID" | sed -E 's/.*"id":"([^"]+)".*/\1/')
echo "DOC_ID=$DOC_ID"

# poll for up to ~10s
for i in 1 2 3 4 5 6 7 8 9 10; do
  STATUS=$(curl -sS -b $COOKIE "http://localhost:8787/api/documents/$DOC_ID" | sed -E 's/.*"ocrStatus":"([^"]+)".*/\1/')
  echo "poll $i: $STATUS"
  [ "$STATUS" != "pending" ] && break
  sleep 1
done

curl -sS -b $COOKIE "http://localhost:8787/api/documents/$DOC_ID" | python3 -m json.tool 2>/dev/null | head -25

pkill -f "tsx watch" 2>/dev/null
sleep 1
```

Expected: status flips to `failed` (no Ollama running) with an `ocrError` set. That confirms the upload + worker + DB update path. The OCR-success path is covered by the unit test using the test seam.

- [ ] **Step 3: Tag**

```bash
git tag phase-3-ocr
```

---

## Self-Review

**Spec coverage:** §4 (OCR pipeline), §8 (`/api/documents` endpoints).

**Type consistency:** `OcrExtracted` shape is the same in shared schema, parser output, and worker write. Field naming conventions: snake_case in Ollama input/output and in SQL columns; camelCase everywhere else.

**Testability:** The Ollama call is replaced via `__setRunVisionOcrForTests`, so document tests run without network or model. The parser is tested as a pure function.

**Known gaps:**
- No client-side image compression (server compresses via sharp). Acceptable for now.
- No SSE / websocket for real-time updates — frontend polls every 1.5s.
- `applied_dated_item_id` is not exposed in the dashboard summary (Phase 4 may surface it on the chip with a "📷" badge).
- iOS HEIC: `sharp` may need a build with libheif. If a HEIC upload throws, the user sees `failed` and can re-shoot as JPEG. Acceptable for v1.
