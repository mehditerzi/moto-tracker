-- ===== Bulk document capture: batches and deferred review =====
--
-- Until now a scan was a solo act: one photo, one upload, one review screen,
-- and the OCR worker applied whatever it was confident about the moment it
-- finished. That is right for "photograph the insurance policy that just
-- arrived". It is wrong for the two onboarding cases this migration exists for:
-- a household putting four vehicles in at once, and a fleet manager holding a
-- stack of twenty ruhsat.
--
-- A BATCH is the set of documents photographed in one sitting. It exists for
-- three reasons, in order of importance:
--
--   1. It makes review a single pass. Twenty documents reviewed one navigation
--      at a time is twenty chances to lose your place; a batch is a cursor.
--   2. It defers the write. Inside a batch the worker does NOT auto-apply —
--      see ocr/worker.ts. Nothing is created or patched until the user applies
--      the batch, so a misread plate never silently mints a vehicle, and the
--      vehicle quota is not spent before anyone has seen the results.
--   3. It survives leaving. The worker keeps reading whether or not the app is
--      open, and every per-document decision is persisted here, so closing the
--      app mid-review costs nothing.

CREATE TABLE IF NOT EXISTS document_batch (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  -- NULL = the uploader's personal garage; set = an organization's.
  --
  -- This column is the whole org-safety story for bulk capture. A single scan
  -- infers its org from the vehicle it was attached to (documents.ts), but a
  -- batch has no vehicle — it is where vehicles come FROM. So the target garage
  -- is chosen once, up front, and every vehicle the batch creates lands in it.
  -- Without this a fleet manager's twenty company ruhsat would be created as
  -- twenty personal vehicles in their own garage: exactly the leak that
  -- ocr/autoApply.ts was recently fixed to prevent, re-introduced in bulk.
  org_id TEXT REFERENCES organization(id) ON DELETE CASCADE,
  -- open      — still capturing or reviewing; the only state that accepts
  --             uploads, decisions and an apply.
  -- applied   — committed. Terminal: `applied_at` is set and a second apply is
  --             refused, so a double-tap or a retried request cannot create the
  --             same vehicles twice.
  -- discarded — the user threw the batch away; its documents are deleted with
  --             it, but the row is kept so an in-flight OCR job that lands
  --             afterwards has somewhere to resolve against.
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','applied','discarded')),
  applied_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- "Do I have a batch waiting for me?" — the resume prompt on the capture screen.
CREATE INDEX IF NOT EXISTS idx_batch_user_status ON document_batch(user_id, status, created_at DESC);

-- ===== document: membership, order, and the user's decision =====

-- ON DELETE SET NULL, not CASCADE: discarding a batch is an explicit act that
-- deletes the documents itself (and their files on disk). A cascade here would
-- make a stray batch delete silently take image files with it and leave orphans
-- under UPLOADS_DIR, which nothing would ever clean up.
ALTER TABLE document ADD COLUMN batch_id TEXT REFERENCES document_batch(id) ON DELETE SET NULL;

-- Capture order. The review pass must present documents in the order they were
-- photographed — the user remembers "the third one was the trailer" — and
-- created_at cannot be trusted for that: sqlite's datetime('now') has
-- one-second resolution, and a burst of shots uploads several per second.
ALTER TABLE document ADD COLUMN batch_seq INTEGER;

-- Where this document is in the review pass.
--   pending   — read but not yet looked at by a human (or still being read).
--   confirmed — the user approved it; `review_decision_json` says what to do.
--   skipped   — the user deliberately passed over it. Not a failure: an
--               unreadable scan and a document that is not a ruhsat both end
--               here, and neither blocks applying the rest of the batch.
--   applied   — committed by a batch apply. Terminal.
ALTER TABLE document ADD COLUMN review_state TEXT NOT NULL DEFAULT 'pending'
  CHECK (review_state IN ('pending','confirmed','skipped','applied'));

-- The user's corrections, as JSON: which vehicle to touch (or that a new one is
-- wanted), the field values they settled on, and the renewal dates they want
-- recorded. Stored rather than held in component state because the review pass
-- is explicitly resumable — a batch half-reviewed on a phone that then rang
-- must not lose the eleven documents already checked.
ALTER TABLE document ADD COLUMN review_decision_json TEXT;

-- What the server thinks this scan is about, computed once when OCR finishes:
-- the existing vehicle whose plate/chassis it matches, if any. It drives the
-- create-vs-update question on the review screen — and the duplicate-plate
-- warning, which is the same question asked the other way round.
ALTER TABLE document ADD COLUMN suggested_bike_id TEXT REFERENCES bike(id) ON DELETE SET NULL;

-- The review pass walks one batch in capture order; the progress header counts
-- statuses within one batch. Both are this index.
CREATE INDEX IF NOT EXISTS idx_doc_batch_seq ON document(batch_id, batch_seq);
