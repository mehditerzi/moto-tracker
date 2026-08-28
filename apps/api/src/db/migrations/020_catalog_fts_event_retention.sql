-- Three small operational additions.
--
-- 1) app_meta — key/value scratch table used by seedCatalog.ts (catalog
--    fingerprint) and by notify/cron.ts (the day of the last reminder
--    dispatch, which drives the missed-run catch-up). seedCatalog created it
--    lazily at runtime; declare it here so it exists before anything reads it.
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 2) Telemetry retention. The daily prune deletes by created_at; the existing
--    index is (name, created_at) which can't drive that range scan on its own.
CREATE INDEX IF NOT EXISTS idx_event_created ON event(created_at);

-- 3) Make autocomplete. `norm LIKE '%q%'` has a leading wildcard, so every
--    keystroke was a full scan of vehicle_make (~1.9k rows today, and the
--    generated catalog only grows). An FTS5 trigram index answers the same
--    substring predicate from an index for queries of 3+ characters — same
--    matches, same order, ~6x faster now and ~250x on a 100k-row catalog.
--    Shorter queries (1–2 chars) can't use trigrams and keep the plain scan.
--
--    External-content table (content='vehicle_make'): no duplicate copy of the
--    text, kept in sync by the triggers below. seedCatalog rebuilds the catalog
--    with DELETE + INSERT, which the triggers follow.
CREATE VIRTUAL TABLE IF NOT EXISTS vehicle_make_fts
  USING fts5(norm, content='vehicle_make', content_rowid='id', tokenize='trigram');

CREATE TRIGGER IF NOT EXISTS vehicle_make_fts_ai AFTER INSERT ON vehicle_make BEGIN
  INSERT INTO vehicle_make_fts(rowid, norm) VALUES (new.id, new.norm);
END;
CREATE TRIGGER IF NOT EXISTS vehicle_make_fts_ad AFTER DELETE ON vehicle_make BEGIN
  INSERT INTO vehicle_make_fts(vehicle_make_fts, rowid, norm) VALUES ('delete', old.id, old.norm);
END;
CREATE TRIGGER IF NOT EXISTS vehicle_make_fts_au AFTER UPDATE ON vehicle_make BEGIN
  INSERT INTO vehicle_make_fts(vehicle_make_fts, rowid, norm) VALUES ('delete', old.id, old.norm);
  INSERT INTO vehicle_make_fts(rowid, norm) VALUES (new.id, new.norm);
END;

-- Backfill whatever is already seeded (no-op on a fresh database).
INSERT INTO vehicle_make_fts(rowid, norm) SELECT id, norm FROM vehicle_make;
