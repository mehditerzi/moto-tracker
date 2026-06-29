-- Fuel-ups, the basis for fuel economy (L/100km) and cost-per-km. We store the
-- odometer at each fill so distance between fills can be derived; total_cost is
-- optional (some users only log litres). is_full marks a brimmed tank (a partial
-- fill can't anchor a tank-to-tank economy calc).
CREATE TABLE IF NOT EXISTS fuel_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  bike_id TEXT NOT NULL REFERENCES bike(id) ON DELETE CASCADE,
  filled_on TEXT NOT NULL,
  liters REAL NOT NULL,
  total_cost REAL,
  odometer_km INTEGER,
  is_full INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fuel_bike ON fuel_log(bike_id, odometer_km);
CREATE INDEX IF NOT EXISTS idx_fuel_user ON fuel_log(user_id);
