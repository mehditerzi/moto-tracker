-- ===== Fleet operations: what the dispatch board needs from the schema =====
--
-- 021 gave us the tenancy model (organization / org_member / assignment /
-- contract). This migration adds the two things the fleet SCREENS need on top of
-- it: a place to record what a service job cost, and the indexes the triage,
-- inventory and cost rollups scan.

-- The costs screen (/fleet/costs) is what a finance lead buys, and half of a
-- fleet's running cost is maintenance. `maintenance_item` recorded WHAT was done
-- and WHEN, but never what it cost — so the rollup had fuel (fuel_log.total_cost)
-- and compliance (dated_item.cost) but a permanent zero for service work.
--
-- Nullable and additive: no existing row changes, no existing route breaks (they
-- all map columns explicitly rather than spreading the row), and the rollup picks
-- the value up the moment the maintenance capture form starts sending it.
ALTER TABLE maintenance_item ADD COLUMN cost REAL;

-- ===== Indexes for the fleet-wide scans =====
--
-- Every consumer query so far has been "one vehicle, its records". The fleet
-- screens invert that: "every vehicle in this org, one dimension" — which is a
-- range scan per source table, once per screen, instead of N+1 per vehicle.

-- Costs bucket fuel and service by month over a date range, per vehicle.
CREATE INDEX IF NOT EXISTS idx_fuel_bike_filled ON fuel_log(bike_id, filled_on);
CREATE INDEX IF NOT EXISTS idx_maint_bike_done ON maintenance_item(bike_id, last_done_on);
-- Distance falls back to trips when a fleet logs journeys but not odometers.
CREATE INDEX IF NOT EXISTS idx_trip_bike_started ON trip(bike_id, started_at);

-- Triage takes MAX(expires_on) per (vehicle, type) across the whole fleet. The
-- existing idx_dated_bike_type already leads with bike_id, which is what the
-- grouped scan needs; this one serves the "what is overdue anywhere" ordering.
CREATE INDEX IF NOT EXISTS idx_dated_expires ON dated_item(expires_on);

-- The summary strip counts documents still waiting on OCR, per organization.
CREATE INDEX IF NOT EXISTS idx_doc_bike_status ON document(bike_id, ocr_status);
