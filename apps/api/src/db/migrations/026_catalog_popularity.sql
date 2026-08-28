-- Catalog popularity, so the make/model dropdowns open on what a Turkish
-- driver actually owns.
--
-- The make/model comboboxes are the highest-traffic control in the app, and
-- with no query typed they were ordered `(source='overlay') DESC, name ASC` —
-- alphabetically. That put Alfa Romeo at the top of a car-make list in a market
-- that is Fiat/Renault/Volkswagen, and opened Renault's models on "Arkana"
-- instead of "Clio". Every one of those is a scroll or a typed character that
-- did not need to exist.
--
-- The curated overlay in scripts/fetch-moto-catalog.mjs is ordered by Turkish
-- prevalence; that order is emitted as a 1–1000 rank and lands here. 0 means
-- unranked (vPIC breadth, API-Ninjas harvest), which sorts last and preserves
-- the previous alphabetical behaviour for everything uncurated.
--
-- Ranks are per vehicle type on the MAKE, because the two overlays are ranked
-- independently: Honda leads the motorcycle list and sits mid-table among cars,
-- and a single column would have dragged it to the top of both. A MODEL row
-- already carries its own `type`, so one column is enough there.

ALTER TABLE vehicle_make ADD COLUMN pop_car  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vehicle_make ADD COLUMN pop_moto INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vehicle_model ADD COLUMN popularity INTEGER NOT NULL DEFAULT 0;

-- Serves the no-query "open the dropdown" case, which is the common one:
-- covering index for `WHERE make_id = ? ORDER BY popularity DESC, name`.
CREATE INDEX IF NOT EXISTS idx_model_make_pop ON vehicle_model(make_id, popularity DESC, name);

-- seedCatalog.ts rebuilds the catalog whenever the bundled fingerprint changes;
-- bumping it there (v2 → v3) is what backfills these columns on an existing
-- database. Nothing to backfill here — the defaults are correct until then.
--
-- vehicle_make_fts is an FTS5 external-content table over vehicle_make. It
-- resolves its one indexed column (`norm`) by name, so adding columns beside it
-- is transparent and the sync triggers from migration 020 keep working.
