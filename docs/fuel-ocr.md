# Fuel tracking & receipt OCR

Fuel-ups live on the `/fuel` page: date, litres, cost, odometer, full/partial
tank. From them the app derives **L/100km** (tank-to-tank between *full* fills —
partial fills contribute litres but never anchor a segment), **₺/km**, **₺/L**,
monthly-spend bars and a consumption trend line (hand-rolled SVG, no chart lib).

## Receipt scanning

A scanned **pump receipt (yakit fişi)** flows through the same document
pipeline as ruhsat/sigorta scans and, when confident, auto-creates a fuel log:

```
photo → OLLAMA_OCR_MODEL (glm-ocr) image→text   [Tesseract fallback]
      → parse model (OLLAMA_PARSE_MODEL || VISION_MODEL) → JSON (doc_type=yakit)
      → unsure? → OLLAMA_VERIFY_MODEL (qwen3.6) re-parse, better result wins
      → deterministic backstops (LİTRE/TUTAR/B.FİYAT regexes over raw text)
      → validators: litres × unit price must reconcile with the total
          - two of three present → third derived (corrected)
          - all three but >10% off → suspect → confidence capped → review
      → confident + plate-matched vehicle → fuel_log created (is_full=1,
        source_document_id set); document.applied_fuel_log_id links back
      → otherwise → review screen with values pre-filled for a one-tap save
```

A receipt never *creates* a vehicle, and a receipt plate that matches no
vehicle never guesses — both land in review instead.

## Model setup (env)

```
OLLAMA_OCR_MODEL=glm-ocr:latest     # 2.2 GB, reads receipts/documents → text
OLLAMA_VERIFY_MODEL=qwen3.6:35b-mlx # 22 GB second opinion on unsure scans
OCR_TIMEOUT_MS=240000               # verify model cold load + thinking time
```

Both stages are optional: unset `OLLAMA_OCR_MODEL` → Tesseract only; unset
`OLLAMA_VERIFY_MODEL` → no second pass. Either failing falls back gracefully
(the pipeline order above degrades to the pre-existing behavior).

## Model quirks worth knowing

- **glm-ocr** transcribes accurately but loops the transcription until
  `num_predict` runs out — `cleanupExtractedText()` truncates at the first
  repeat and strips markdown fences.
- **qwen3.6 is a reasoning model**: its thinking tokens count against
  `num_predict`, so the verify pass runs with a 4096 cap. Plain parse models
  keep 1024 — given more room they occasionally ramble inside a JSON string
  until the cap cuts it mid-value.
- **gemma4:26b is unreliable on receipt text** (rambles, negative confidence,
  literal `"null"` strings — all now tolerated by the parser). The deployed
  `gemma4` (9.6 GB) parses receipts fine; keep it as the parse model.
- Grammar strings carry `maxLength: 80` so a rambling model gets cut off by
  the grammar instead of producing unterminated JSON.
