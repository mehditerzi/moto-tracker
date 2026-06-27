-- Vehicle (motorcycle + car) make/model catalog. Seeded at startup from the
-- bundled vehicleCatalog.generated.ts (vPIC + curated Turkish-market overlay +
-- API-Ninjas) so OCR can canonicalize extracted make/model against a known-good
-- list and the UI can offer searchable dropdowns. See seedCatalog.ts.

CREATE TABLE IF NOT EXISTS vehicle_make (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL,
  norm    TEXT NOT NULL UNIQUE,
  source  TEXT NOT NULL DEFAULT 'overlay',
  -- Comma-separated vehicle types this make covers, e.g. 'car,motorcycle'.
  types   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS vehicle_make_alias (
  make_id INTEGER NOT NULL REFERENCES vehicle_make(id) ON DELETE CASCADE,
  norm    TEXT NOT NULL,
  PRIMARY KEY (make_id, norm)
);

CREATE TABLE IF NOT EXISTS vehicle_model (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  make_id INTEGER NOT NULL REFERENCES vehicle_make(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  norm    TEXT NOT NULL,
  type    TEXT NOT NULL DEFAULT 'motorcycle',
  UNIQUE (make_id, norm)
);

CREATE INDEX IF NOT EXISTS idx_make_alias_norm ON vehicle_make_alias(norm);
CREATE INDEX IF NOT EXISTS idx_model_make ON vehicle_model(make_id);
CREATE INDEX IF NOT EXISTS idx_model_norm ON vehicle_model(norm);
