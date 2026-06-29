-- GPS-tracked trips. Each row is one completed journey attributed to a vehicle.
-- We store only the aggregate (distance + start/end + sample count), not the raw
-- path, to keep location data minimal. The ≥15 km minimum is enforced at the API
-- (see tripCreateSchema), so every persisted trip is a "real" journey.
CREATE TABLE IF NOT EXISTS trip (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  bike_id TEXT NOT NULL REFERENCES bike(id) ON DELETE CASCADE,
  distance_km REAL NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  point_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trip_bike ON trip(bike_id, ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_trip_user ON trip(user_id);
