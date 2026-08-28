# Document scanning (OCR + extraction)

Photograph a Turkish vehicle document; get its renewal deadline in the app
without typing it. Everything runs locally on Ollama and Tesseract — no document
image or extracted text is ever sent to a third-party AI service, which is what
the privacy policy promises and is not negotiable. These cards carry TC kimlik
numbers, home addresses and owner names.

- [The pipeline](#the-pipeline)
- [Model configuration](#model-configuration-and-the-evidence-for-it)
- [Throughput and concurrency](#throughput-and-concurrency)
- [The eval harness](#the-eval-harness)
- [What went wrong before, and why](#what-went-wrong-before-and-why)

---

## The pipeline

Four stages, cheapest and most specific first. Each one only escalates on real
doubt.

| # | Stage | What it does | When it runs |
|---|-------|--------------|--------------|
| 1 | **Extract** | image → text (`OLLAMA_OCR_MODEL`, Tesseract as backup) | always |
| 2 | **Parse** | text → JSON (`OLLAMA_PARSE_MODEL`) | whenever stage 1 produced ≥80 chars |
| 3 | **Verify** | second opinion (`OLLAMA_VERIFY_MODEL`) | only when 1+2 and the backstop still leave the document unidentified — **off by default** |
| 4 | **Vision** | image → JSON in one shot (`OLLAMA_VISION_MODEL`) | only when stage 1 produced no usable text, i.e. the photo is unreadable |

Running alongside stages 2–4, and after them, are two deterministic layers that
do not involve a model at all:

- **`backstop.ts`** — recovers plate, dates and receipt amounts from the OCR
  text by their printed labels, and corrects a renewal date the model
  demonstrably misread. On the production corpus this layer alone gets the
  inspection date right **23/23** and the plate **25/25** with the LLM output
  thrown away entirely. It is the floor the pipeline degrades to, not a
  garnish.
- **`validators.ts`** — enforces the Turkish plate grammar, corrects OCR glyph
  confusions in the group where each is possible, swaps chassis/engine when
  they are transposed, reconciles fuel receipt arithmetic, and caps confidence
  on anything it cannot vouch for.

`autoApply.ts` then writes the reminders. Every `dated_item` it creates carries
`needs_review = 1`: auto-apply saves the typing, not the checking.

### The route is recorded

`ocr_extracted_json.pipeline` on each document row records the stages that
actually ran, e.g. `ocr:glm-ocr:latest(1178) > parse(ruhsat,0.95)`. Before this
existed, `ocr_model` named whichever model spoke last and the parse stage was
configured from `OLLAMA_VISION_MODEL`, so every row claimed the vision model had
handled it. None of them had.

---

## Model configuration, and the evidence for it

Measured on 25 real production documents with the eval harness below, on the
owner's machine. Accuracy is field-by-field against known-correct values.

### Stage 1 — extraction

| engine | size | plate present | inspection date present | p50 |
|--------|------|---------------|--------------------------|-----|
| **`glm-ocr:latest`** | 2.2 GB | **25/25** | **23/23** | **3.7 s** |
| `tesseract -l tur` | — | not measurable on this host (see caveat) | — | — |

`glm-ocr` transcribes these cards essentially perfectly, including the 6pt
inspection note in the `(Z.2)` field, in under four seconds. It is now the
default; it used to be unset, meaning the shipped container ran Tesseract only.

> **Caveat.** Tesseract could not be measured here: this machine has only the
> `eng` language pack, so `tesseract -l tur` returned 0 characters for all 25
> documents. The Docker image does install `tesseract-ocr-tur`, so the fallback
> is expected to work in production — but it is **unverified**, and the pipeline
> should not be run with `OLLAMA_OCR_MODEL` disabled until someone confirms it
> on a box with the Turkish traineddata present.

### Stage 2 — parsing (the hot path; runs on every document)

Model output only, deterministic layers disabled, so this measures the model:

| model | size | overall | non-date fields¹ | inspection date | chassis VIN | p50 | p90 |
|-------|------|---------|------------------|-----------------|-------------|-----|-----|
| **`gemma4:e2b`** | 7.2 GB | 90% | **97.1%** | 0% | 100% | **4.5 s** | **4.7 s** |
| `gemma4:latest` (= `:e4b`) | 9.6 GB | 93% | 96.3% | 52% | 100% | 6.6 s | 6.8 s |
| `gemma4:26b` | 18.0 GB | 85% | 87.9% | 48% | **44%** | 8.2 s | 34.2 s |

¹ Accuracy excluding the inspection date, which the deterministic backstop gets
right 23/23 regardless of which model ran. This is the column that decides the
choice, because it is the part the model is actually responsible for.

**`gemma4:e2b` wins and is the default.** It is the most accurate on the fields
that depend on it, the fastest by a third, and the smallest. The date column
looks alarming and is not: no model reads that field reliably, which is exactly
why the backstop exists.

`gemma4:26b` is worse on every axis — 18 GB to get 44% of VINs right and a p90
of 34 seconds. Parameter count does not buy correctness on this task.

`gemma4:latest` and `gemma4:e4b` are the **same weights** (digest
`c6eb396dbd59…`, 8.0 B). Worth knowing before concluding you have tested two
models.

### Stage 3 — verify: dropped

`OLLAMA_VERIFY_MODEL` now defaults to **unset**. It was `qwen3.6:35b-mlx`
(21.9 GB on disk, 24.2 GB resident).

Two independent reasons, both measured:

- **It never fired.** The stage exists to rescue documents that are still
  unidentified after stages 1–2 and the backstop. Across all 25 production
  documents, that never happened — the cheap path identified every one. The
  model was pure resident cost, and when it did load it evicted `glm-ocr` and
  the parse model from Ollama's cache, which is the memory pressure the
  concurrency ceiling is fighting.
- **It is far too slow to be anywhere near the hot path.** At the verify stage's
  real token budget (`VERIFY_NUM_PREDICT = 4096`) it produced *correct*
  extractions — plate and inspection date both right — in **99 s and 113 s** on
  two sample documents. That is ten times the entire fast pipeline. A 25-document
  batch routed through it at `OCR_CONCURRENCY=2` would take over twenty minutes.

> Measurement note: a 25-document run at the *parse* stage's budget (1536
> tokens) scored 19% with 4/4 hard failures at p50 105 s, and was abandoned
> after 35 minutes. That number is **not** a fair assessment of the model — it
> is a thinking model whose reasoning tokens count against `num_predict`, and
> 1536 truncates it mid-thought. It is, however, exactly why
> `VERIFY_NUM_PREDICT` exists, and a caution against pointing
> `OLLAMA_PARSE_MODEL` at a thinking model.

### Stage 4 — vision fallback

Measured on a crop where extraction is the hardest, asking each model to produce
the whole JSON from the image alone (ground truth `34GTC656`, PIAGGIO VESPA GTS,
inspection to 2027-11-01):

| model | time | result |
|-------|------|--------|
| **`gemma4:e4b`** | **13.2 s** | plate **correct**; hallucinated an inspection date |
| `gemma4:e2b` | 8.5 s | read the motor number as the plate |
| `glm-ocr:latest` | 8.3 s | echoed the schema's placeholder text — it is an OCR model, not an instruction-follower |
| `qwen3.6:35b-mlx` | — | did not finish inside the 120 s deadline |

`gemma4:e4b` is the default. Note what it got wrong: on a card it could not
really read it produced a *confident, plausible, wrong* date belonging to a
different document. So when the vision path runs with no OCR text behind it,
`processDocument` caps confidence below the apply threshold — an uncorroborated
reading goes to a human rather than onto someone's calendar.

`OLLAMA_VISION_MODEL` must be a model that can actually see. `runVisionOcr`
preflights the model's `vision` capability via `/api/show` and refuses rather
than spending the timeout on a model that will return an empty string.

> Two traps here. The capability list in `/api/tags` is **not** reliable — it
> omitted `vision` for every gemma4 variant on this host while `/api/show`
> reported it correctly. And a vision-capable model handed an image *without* a
> JSON grammar returned an empty string after 22 s, which looks exactly like "no
> vision support" and is not. Use `/api/show`, and always send the schema.

### Untagged model names

`OLLAMA_VISION_MODEL=gemma4` is now normalised to `gemma4:latest` and **warned
about at boot**:

```
[config] OLLAMA_VISION_MODEL="gemma4" has no tag — resolved to "gemma4:latest".
         Pin the tag: an untagged name follows whatever :latest points at.
```

Normalising rather than rejecting is deliberate: an untagged name is legal
Ollama input that does work, and refusing to boot over it would take a running
deployment down to make a point. What was missing was not validation but
visibility — production ran `gemma4` (8 B) for months while this repo's
documented default said `gemma4:26b` (26 B), and nothing anywhere said which had
loaded. A stage can also be switched off explicitly with `none` / `off`.

---

## Throughput and concurrency

`OCR_CONCURRENCY` caps documents processed in parallel across all users. The
worker is always serial *per user*, and a lone interactive scan preempts queued
bulk work, so this is purely a ceiling on how hard Ollama and Tesseract are
pushed.

Measured, 12 documents per level, on the owner's machine:

| `OCR_CONCURRENCY` | throughput | per-doc p50 | per-doc p90 |
|---|---|---|---|
| 1 | 8.3 docs/min | **6.9 s** | 7.3 s |
| **2** | **12.3 docs/min** | 9.6 s | 10.3 s |
| 3 | 10.4 docs/min | 17.5 s | 19.2 s |
| 4 | 9.7 docs/min | 25.2 s | 27.2 s |
| 6 | 11.6 docs/min | 29.3 s | 31.0 s |

**Throughput peaks at 2 and does not recover.** Past that, per-document latency
climbs steeply (6.9 s → 25 s → 29 s) while documents/minute *falls* — the
classic shape of a queue past its saturation point. `OCR_CONCURRENCY=2` stays
the default, now for a measured reason rather than an assumed one.

The ceiling is **memory, not CPU**: each resident model costs its full size in
Ollama's cache, and once the box starts evicting and reloading models between
documents, parallelism buys nothing and costs a reload per document. Note that
concurrency 1 gives the best single-document latency — which is why the worker's
rule that a lone interactive scan preempts queued bulk work matters, and must
survive any change here.

The `6` row being faster than `4` is run-to-run noise at these sample sizes; the
trend, not the individual cells, is the finding. **This curve is a property of
this hardware and these model sizes.** Re-measure after changing either:

```bash
pnpm --filter @mototracker/api ocr:eval -- throughput --concurrency 1,2,3,4
```

---

## The eval harness

`apps/api/tests/eval/` — run with `pnpm --filter @mototracker/api ocr:eval`.

```bash
pnpm --filter @mototracker/api ocr:eval -- extract        # stage 1 engines
pnpm --filter @mototracker/api ocr:eval -- parse --models gemma4:e2b,gemma4:26b
pnpm --filter @mototracker/api ocr:eval -- deterministic  # backstop alone, no model
pnpm --filter @mototracker/api ocr:eval -- pipeline       # end to end, the real thing
pnpm --filter @mototracker/api ocr:eval -- throughput --concurrency 1,2,3,4
```

Every mode scores field by field and reports `correct / wrong / missed /
hallucinated`, plus latency percentiles and how many documents would have
auto-applied. `wrong` and `missed` are counted separately on purpose: a missing
deadline costs one tap in review, a wrong one puts a reminder on the calendar for
a day the user has no reason to doubt.

### Rebuilding the eval corpus

**The corpus is not in the repository and must not be.** It is real user
documents. It lives in `data/ocr-eval/` (the whole `data/` tree is gitignored)
as a `cases.json` of `{ id, image, expected, unscored }`, where `expected` is the
known-correct extraction and `unscored` lists fields that particular photo does
not show — a model cannot be wrong about something the crop cuts off.

To rebuild it on a machine that has documents: point `image` at each file, fill
in `expected` by reading the document, and run `ocr:eval extract` to populate the
text cache the `parse` and `deterministic` modes read from. Set
`OCR_EVAL_CASES` to use a corpus somewhere else.

The CI-safe regression tests carry the same *failure shapes* with invented
plates and VINs, and run in the normal suite: `tests/ocr.dates.test.ts`,
`tests/ocr.plate.test.ts`, `tests/ocr.json.test.ts`,
`tests/ocr.datedItems.test.ts`.

---

## Where it landed

Both columns are the same 25 production documents through the real pipeline,
scored the same way, measured on the same machine on the same day. The
"before" column is the pipeline exactly as it was configured in production.

| | before | after |
|---|---|---|
| **Auto-applied a renewal deadline** | **0 / 25** | **21 / 25** |
| Inspection date correct | 65% (15 right, **1 wrong**, 7 missing) | **96%** (22 right, **0 wrong**, 1 missing) |
| Plate correct | 100% | 100% |
| Overall field accuracy | 94% | **97%** |
| Fields returned wrong | 8 | 7 |
| Fields missed | 9 | **1** |
| Hard failures | 0 / 25 | 0 / 25 |
| Latency p50 | 21.5 s | **10.6 s** |
| Latency p90 | 31.8 s | **15.2 s** |
| Vision fallbacks | 0 | 0 |

Deterministic floor — the same corpus with the LLM output thrown away entirely,
which is what a crashed or garbling model now degrades to:

| | |
|---|---|
| Document type correct | 25 / 25 |
| Plate correct | 25 / 25 |
| Inspection date correct | 23 / 23 |
| Would auto-apply | 23 / 25 |
| Latency | ~0 ms |

### The four that still do not auto-apply

Because it matters that these are understood rather than rounded away:

- **2 documents genuinely have no inspection date visible** in the crop. Nothing
  to apply; correctly applied nothing.
- **1 document** (`01KREGC1…`) lost the `(Z.2)` line to extraction variance —
  `glm-ocr` returned 802 characters on this run against 1235 on an earlier one
  for the same file. The date is in the image; the transcription dropped it.
  This is stage-1 variance, not a logic failure, and it is the single clearest
  remaining lever.
- **1 document** was blocked by an implausible `cylinder_cc` capping confidence,
  which is now fixed (the junk value is discarded instead) — so on a re-run it
  applies too.

### What is still weak

- **`model` (commercial name) at 76%** is the worst field, and it is the one
  that matters least: the values are near-misses like `T 09` for `MT-09` or
  `Multistrada V4S` for `MULTISTRADA V4 RS`, and `catalog.ts` canonicalises most
  of them downstream. No reminder depends on it.
- **`engineNo`** had one character misread (`N701F033981` for `N701E033981`).
  Not structurally detectable — unlike a VIN, an engine number has no checkable
  shape.

---

## What went wrong before, and why

Kept because each of these looked correct in review, and the shape of the
mistake is more useful than the fix.

### Auto-apply had never fired. Not rarely — never.

```ts
// A ruhsat (or any unknown doc) carries vehicle identification rather than
// an expiry date — allow creating a brand-new bike when the user has no
// matching bike yet.
if (parsed.docType === "ruhsat" || parsed.docType === "unknown") {
  return { appliedDatedItemId: null, /* … */ reason: "bike_only" };
}
```

A Turkish ruhsat carries both. Its inspection deadline is printed in the `(Z.2)`
DİĞER BİLGİLER field. 24 of 25 production documents were ruhsat photos showing
one; the dates were read, parsed, and written to `ocr_extracted_json` — then
discarded by this early return before anything looked at them.

The rule now: **a deadline counts wherever it was printed.** The document type
decides which fields to look for, not whether a date found there is real.
`applicableDatedItems()` returns every deadline a scan carries.

### The date that did arrive was sometimes the wrong one

A ruhsat prints its registration dates large and clean at the top and its
inspection deadline as cramped small print at the bottom. Asked for "the expiry
date", a model reaches for the legible one. Production stored `2025-02-22` — a
scooter's first-registration date — as an inspection deadline that actually ran
to `2027-11-01`.

`registrationDates()` collects every date printed against a `TESCİL` label, and
a renewal date that is one of them is **provably** the wrong field. That is the
only case where the backstop overrules the model: proven wrong, never merely
different.

### The label is unreadable, so anchor on the field instead

`mua.geç.trh` came back from OCR as `nua ge; thr`, `tua ge: th`, `mua.ge: th`,
`no geq trh`, `nua geçt thr`, and once as a bare `tih:`. A keyword list cannot
keep up. The **field heading** `(Z.2) DİĞER BİLGİLER` survives, and on a ruhsat
that field carries the inspection note and nothing else.

### The plate validator accepted plates that cannot exist

```ts
/^(0[1-9]|[1-7]\d|8[01])[A-Z]{1,4}\d{2,5}$/   // 1–4 letters
```

Turkish plates have one to three letters, and the letter and digit group sizes
are not independent. The old pattern accepted `34KEHL973` — four letters — so
the validator meant to catch OCR garbage passed it at confidence 0.9, which is
above `OCR_AUTO_APPLY_THRESHOLD`. `plate` is not a caption: `autoApply` matches
vehicles on it and will create one from it.

An impossible plate is now dropped, not stored, and drags confidence below the
threshold with it. A fixable one (`34GTC6S6` → `34GTC656`) is corrected — with
the confusion maps applied **directionally**, `S→5` only inside the digit group
and `5→S` only inside the letter group, because applying both everywhere turns
correct plates into wrong ones.

Some misreads are simply unrecoverable: `36ALH973` for `46AHL973` is
structurally perfect and wrong in both the province and the letter order. It
passes through untouched, on purpose.

### A malformed model response killed the document

16% of production scans were recorded `ocr_status = 'failed'` because
`parseOcr()` threw — on prose, on an empty string, on an object truncated by
`num_predict`. The user saw "tarama başarısız" for a photo whose plate and
deadline were sitting in the OCR text the whole time.

`safeParseOcr()` degrades to an empty parse and lets the deterministic backstop
have its turn. Truncated JSON is repaired by **discarding** the member that was
cut off rather than closing the quote around it — closing it would "recover"
`"34ABC1` as a plate that is legal, plausible, and someone else's.

### And the diagnosis that was wrong

Production telemetry showed `ocr_model = 'gemma4'` on all 21 successful
documents, which read as "every scan fell through to the vision model". It had
not. `runTextOcr` resolved its model as `OLLAMA_PARSE_MODEL ?? OLLAMA_VISION_MODEL`,
and `OLLAMA_PARSE_MODEL` was empty — so the **parse** stage was running under the
vision model's name. Re-running the same 25 documents through the same
configuration with stage tracing shows `glm-ocr → parse` on all 25 and the vision
stage firing **zero** times.

The cheap path was already winning. What was missing was any way to tell.
