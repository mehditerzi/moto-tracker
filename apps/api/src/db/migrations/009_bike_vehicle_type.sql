-- Distinguish motorcycles from cars per vehicle, so make/model dropdowns and
-- OCR matching can scope to the right type. Existing rows are motorcycles.
ALTER TABLE bike ADD COLUMN vehicle_type TEXT NOT NULL DEFAULT 'motorcycle'
  CHECK (vehicle_type IN ('motorcycle', 'car'));
