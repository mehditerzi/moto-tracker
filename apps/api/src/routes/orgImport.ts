import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import {
  fleetImportSchema,
  type FleetImportField,
  type FleetImportPreview,
  type FleetImportResult,
  type FleetImportRow,
  type FleetImportRowError,
} from "@mototracker/shared";
import { requireOrgRole } from "../lib/orgAccess.js";
import { countActiveOrgBikes, getOrgMaxVehicles } from "../lib/entitlement.js";
import { normHeader, parseCsv, parseIntish, parseTurkishDate, type CsvDelimiter } from "../lib/csv.js";
import { normPlate } from "../lib/fleet.js";
import { inferVehicleType } from "../ocr/catalog.js";

/**
 * `/fleet/import` — onboarding a fleet that already exists in a spreadsheet.
 *
 * This removes the biggest objection in a sales call ("we already have 40
 * vehicles in Excel"), which is why it is held to a higher standard than a
 * convenience feature: it has to succeed on the file the customer already has,
 * unedited, and it has to be impossible for it to half-succeed.
 *
 * TWO PHASES, and the second repeats the first. `preview` reports every row's
 * errors and writes nothing. `commit` re-parses and re-validates the same text
 * from scratch and refuses the whole file if ANY row is bad — it never trusts a
 * client-side preview, and it never inserts a subset. The writes then happen
 * inside one better-sqlite3 transaction, so a constraint failure on row 39 rolls
 * row 1 back with it.
 */
export const orgImportRouter: Router = Router();
orgImportRouter.use(requireUser);

// ─── column recognition ───────────────────────────────────────────────────────

/**
 * Header synonyms, keyed by `normHeader` (Turkish letters folded, punctuation
 * and spacing dropped) — so `Şasi No`, `SASI_NO` and `şasi  no` are one key.
 *
 * The Turkish names come first in each list because they are what the files
 * actually contain; the English ones are there because half the fleets we have
 * seen keep a bilingual sheet.
 */
const HEADER_ALIASES: Record<string, FleetImportField> = {};
function alias(field: FleetImportField, ...names: string[]): void {
  for (const n of names) HEADER_ALIASES[normHeader(n)] = field;
}

alias("plate", "plaka", "plaka no", "plaka numarası", "araç plakası", "plate", "plate no", "license plate");
alias("nickname", "ad", "adı", "isim", "araç adı", "araç ismi", "etiket", "takma ad", "nickname", "name", "label");
alias("make", "marka", "üretici", "make", "brand", "manufacturer");
alias("model", "model", "model adı", "tip model");
alias("year", "yıl", "model yılı", "model yili", "year", "model year");
alias("currentKm", "km", "kilometre", "güncel km", "mevcut km", "kilometresi", "odometre", "odometer", "mileage");
alias("vehicleType", "tip", "tür", "cins", "cinsi", "araç tipi", "araç türü", "type", "vehicle type");
alias("color", "renk", "color", "colour");
alias("chassisNo", "şasi", "şasi no", "şase no", "şasi numarası", "chassis", "chassis no", "vin", "vin no");
alias("engineNo", "motor no", "motor numarası", "engine", "engine no");
alias("fuelType", "yakıt", "yakıt tipi", "yakıt türü", "fuel", "fuel type");
alias(
  "firstRegistrationDate",
  "tescil tarihi",
  "ilk tescil",
  "ilk tescil tarihi",
  "trafiğe çıkış",
  "trafiğe çıkış tarihi",
  "first registration",
  "first registration date",
);
// The compliance columns are the reason this importer is worth building: a fleet
// spreadsheet is mostly a list of renewal dates, and importing them is what
// turns the triage board on for a new customer on day one instead of month one.
alias("sigorta", "sigorta", "sigorta bitiş", "sigorta bitiş tarihi", "trafik sigortası", "zorunlu trafik", "insurance");
alias("kasko", "kasko", "kasko bitiş", "kasko bitiş tarihi", "casco");
alias("muayene", "muayene", "muayene bitiş", "muayene tarihi", "fenni muayene", "araç muayenesi", "inspection");
alias("mtv", "mtv", "mtv bitiş", "motorlu taşıtlar vergisi", "vergi", "tax");

const DATE_FIELDS: FleetImportField[] = [
  "firstRegistrationDate",
  "sigorta",
  "kasko",
  "muayene",
  "mtv",
];
const DATED_ITEM_FIELDS = ["sigorta", "kasko", "muayene", "mtv"] as const;

const ALL_FIELDS: FleetImportField[] = [
  "plate",
  "nickname",
  "make",
  "model",
  "year",
  "currentKm",
  "vehicleType",
  "color",
  "chassisNo",
  "engineNo",
  "fuelType",
  "firstRegistrationDate",
  "sigorta",
  "kasko",
  "muayene",
  "mtv",
];

const MOTORCYCLE_WORDS = ["MOTOSIKLET", "MOTOSIKLETI", "MOTOR", "MOTORCYCLE", "MOTORBIKE", "MOTO", "SCOOTER"];
const CAR_WORDS = [
  "OTOMOBIL",
  "OTO",
  "ARABA",
  "BINEK",
  "CAR",
  "AUTO",
  "KAMYONET",
  "PANELVAN",
  "VAN",
  "MINIBUS",
  "TICARI",
];

function readVehicleType(raw: string): "motorcycle" | "car" | null {
  const v = normHeader(raw);
  if (!v) return null;
  if (MOTORCYCLE_WORDS.includes(v)) return "motorcycle";
  if (CAR_WORDS.includes(v)) return "car";
  return null;
}

// ─── validation ───────────────────────────────────────────────────────────────

interface ValidatedRow extends FleetImportRow {
  /** The insert-ready shape, present only when `errors` is empty. */
  bike: {
    plate: string | null;
    nickname: string;
    make: string | null;
    model: string | null;
    year: number | null;
    currentKm: number | null;
    vehicleType: "motorcycle" | "car";
    color: string | null;
    chassisNo: string | null;
    engineNo: string | null;
    fuelType: string | null;
    firstRegistrationDate: string | null;
  } | null;
  dated: { type: (typeof DATED_ITEM_FIELDS)[number]; expiresOn: string }[];
}

interface Validation {
  delimiter: string;
  columns: { raw: string; field: FleetImportField | null }[];
  missingFields: FleetImportField[];
  rows: ValidatedRow[];
}

/**
 * Parse and validate the whole file. Pure: it touches the database only to read
 * the plates already registered to the org, and never writes.
 */
function validate(orgId: string, csv: string, forced?: CsvDelimiter): Validation {
  const table = parseCsv(csv, forced);
  const columns = table.header.map((raw) => ({ raw, field: HEADER_ALIASES[normHeader(raw)] ?? null }));
  const present = new Set(columns.map((c) => c.field).filter((f): f is FleetImportField => f !== null));

  // Plates already in this org, normalised. Archived vehicles count: re-importing
  // a plate that is merely archived would create a duplicate the operator then
  // has to reconcile by hand.
  const existingPlates = new Set(
    (
      getDb().prepare("SELECT plate FROM bike WHERE org_id = ?").all(orgId) as {
        plate: string | null;
      }[]
    )
      .map((r) => normPlate(r.plate))
      .filter((p) => p.length > 0),
  );
  const seenInFile = new Map<string, number>();
  const thisYear = new Date().getFullYear();

  const rows: ValidatedRow[] = table.rows.map((r, i) => {
    const errors: FleetImportRowError[] = [];
    const values: FleetImportRow["values"] = {};
    const cell = (field: FleetImportField): string => {
      const idx = columns.findIndex((c) => c.field === field);
      return idx >= 0 ? (r.cells[idx] ?? "") : "";
    };
    const push = (field: FleetImportField | null, code: string) => errors.push({ field, code });

    const rawPlate = cell("plate");
    const plateNorm = normPlate(rawPlate);
    if (rawPlate && (plateNorm.length < 4 || plateNorm.length > 15)) {
      push("plate", "invalid_plate");
    } else if (plateNorm) {
      values.plate = plateNorm;
      if (existingPlates.has(plateNorm)) push("plate", "plate_exists");
      const firstSeen = seenInFile.get(plateNorm);
      if (firstSeen !== undefined) push("plate", "duplicate_plate_in_file");
      else seenInFile.set(plateNorm, i);
    }

    const make = cell("make") || null;
    const model = cell("model") || null;
    if (make) values.make = make;
    if (model) values.model = model;

    // `bike.nickname` is NOT NULL, but a fleet spreadsheet has plates, not pet
    // names. Fall back to the plate, then to make+model, and only complain when
    // the row identifies nothing at all.
    const nickname =
      cell("nickname") || plateNorm || [make, model].filter(Boolean).join(" ") || "";
    if (!nickname) push("nickname", "nickname_required");
    else values.nickname = nickname;

    let year: number | null = null;
    if (cell("year")) {
      year = parseIntish(cell("year"));
      if (year === null || year < 1900 || year > thisYear + 2) push("year", "invalid_year");
      else values.year = year;
    }

    let currentKm: number | null = null;
    if (cell("currentKm")) {
      currentKm = parseIntish(cell("currentKm"));
      if (currentKm === null || currentKm < 0 || currentKm > 10_000_000) push("currentKm", "invalid_km");
      else values.currentKm = currentKm;
    }

    let vehicleType: "motorcycle" | "car" | null = null;
    if (cell("vehicleType")) {
      vehicleType = readVehicleType(cell("vehicleType"));
      if (!vehicleType) push("vehicleType", "invalid_vehicle_type");
      else values.vehicleType = vehicleType;
    }

    const dates = new Map<FleetImportField, string>();
    for (const f of DATE_FIELDS) {
      const raw = cell(f);
      if (!raw) continue;
      const iso = parseTurkishDate(raw);
      if (!iso) push(f, "invalid_date");
      else {
        dates.set(f, iso);
        values[f] = iso;
      }
    }

    for (const f of ["color", "chassisNo", "engineNo", "fuelType"] as const) {
      const v = cell(f);
      if (v) values[f] = v;
    }

    // A row that mapped to nothing at all is a stray line, not a vehicle.
    if (Object.keys(values).length === 0) push(null, "empty_row");

    const ok = errors.length === 0;
    return {
      row: i + 1,
      line: r.line,
      values,
      errors,
      bike: ok
        ? {
            plate: plateNorm || null,
            nickname,
            make,
            model,
            year,
            currentKm,
            // Same inference the create-vehicle route uses, so an imported
            // vehicle is typed exactly as a hand-entered one would be.
            vehicleType: vehicleType ?? inferVehicleType(make, model) ?? "car",
            color: cell("color") || null,
            chassisNo: cell("chassisNo") || null,
            engineNo: cell("engineNo") || null,
            fuelType: cell("fuelType") || null,
            firstRegistrationDate: dates.get("firstRegistrationDate") ?? null,
          }
        : null,
      dated: ok
        ? DATED_ITEM_FIELDS.flatMap((t) => {
            const iso = dates.get(t);
            return iso ? [{ type: t, expiresOn: iso }] : [];
          })
        : [],
    };
  });

  return {
    delimiter: table.delimiter,
    columns,
    missingFields: ALL_FIELDS.filter((f) => !present.has(f)),
    rows,
  };
}

function toPreview(orgId: string, v: Validation): FleetImportPreview {
  const validRows = v.rows.filter((r) => r.errors.length === 0).length;
  const currentVehicles = countActiveOrgBikes(orgId);
  const maxVehicles = getOrgMaxVehicles(orgId);
  return {
    orgId,
    delimiter: v.delimiter,
    columns: v.columns,
    missingFields: v.missingFields,
    totalRows: v.rows.length,
    validRows,
    errorRows: v.rows.length - validRows,
    maxVehicles,
    currentVehicles,
    wouldExceedLimit: currentVehicles + validRows > maxVehicles,
    rows: v.rows.map((r) => ({ row: r.row, line: r.line, values: r.values, errors: r.errors })),
  };
}

// ─── routes ───────────────────────────────────────────────────────────────────

/**
 * Dry run. Owner/manager only, because an import grows the fleet and the fleet's
 * size is what the organization is billed for — the same reason staff cannot
 * create a vehicle through `POST /api/bikes`.
 */
orgImportRouter.post(
  "/:orgId/import/vehicles/preview",
  requireOrgRole("owner", "manager"),
  asyncHandler(async (req, res) => {
    const body = fleetImportSchema.parse(req.body);
    const orgId = req.orgMembership!.orgId;
    const v = validate(orgId, body.csv, body.delimiter);
    // Nothing recognisable means the wrong file, or a delimiter we sniffed
    // wrongly. Saying so is far more useful than 40 rows of `empty_row`.
    if (v.columns.every((c) => c.field === null)) {
      res.status(400).json({ error: "no_recognised_columns", preview: toPreview(orgId, v) });
      return;
    }
    res.json(toPreview(orgId, v));
  }),
);

orgImportRouter.post(
  "/:orgId/import/vehicles/commit",
  requireOrgRole("owner", "manager"),
  asyncHandler(async (req, res) => {
    const body = fleetImportSchema.parse(req.body);
    const db = getDb();
    const orgId = req.orgMembership!.orgId;
    const userId = req.user!.id;

    // Re-validated from the raw text, never from anything the client kept.
    const v = validate(orgId, body.csv, body.delimiter);
    const preview = toPreview(orgId, v);

    if (v.columns.every((c) => c.field === null)) {
      res.status(400).json({ error: "no_recognised_columns", preview });
      return;
    }
    // All-or-nothing: one bad row and the file is rejected whole. Partially
    // importing a fleet is worse than importing none of it — the operator cannot
    // tell what landed, and re-running produces duplicates.
    if (preview.errorRows > 0) {
      res.status(400).json({ error: "import_invalid", preview });
      return;
    }
    if (preview.totalRows === 0) {
      res.status(400).json({ error: "import_empty", preview });
      return;
    }
    // The org's ceiling is checked against the WHOLE file, before anything is
    // written — importing up to the limit and then failing would leave the
    // customer half-onboarded and out of slots.
    if (preview.wouldExceedLimit) {
      res.status(403).json({ error: "vehicle_limit_reached", preview });
      return;
    }

    const bikeIds: string[] = [];
    let datedItemsCreated = 0;
    const insertBike = db.prepare(
      `INSERT INTO bike (id, user_id, org_id, vehicle_type, nickname, plate, make, model, year,
                         current_km, color, chassis_no, engine_no, fuel_type, first_registration_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertDated = db.prepare(
      `INSERT INTO dated_item (id, bike_id, user_id, type, expires_on) VALUES (?, ?, ?, ?, ?)`,
    );

    const run = db.transaction(() => {
      for (const r of v.rows) {
        const b = r.bike!;
        const id = newId();
        insertBike.run(
          id,
          // Custodian, not owner: on an org vehicle `bike.user_id` only records
          // who registered the row (021_organization.sql). Access comes from
          // membership, so importing does not give the importer anything.
          userId,
          orgId,
          b.vehicleType,
          b.nickname,
          b.plate,
          b.make,
          b.model,
          b.year,
          b.currentKm,
          b.color,
          b.chassisNo,
          b.engineNo,
          b.fuelType,
          b.firstRegistrationDate,
        );
        bikeIds.push(id);
        for (const d of r.dated) {
          insertDated.run(newId(), id, userId, d.type, d.expiresOn);
          datedItemsCreated++;
        }
      }
    });
    run();

    const result: FleetImportResult = {
      orgId,
      created: bikeIds.length,
      bikeIds,
      datedItemsCreated,
    };
    res.status(201).json(result);
  }),
);
