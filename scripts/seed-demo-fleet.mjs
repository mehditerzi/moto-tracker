#!/usr/bin/env node
/**
 * ============================================================================
 * seed-demo-fleet — the Garajım demo organizations.
 * ============================================================================
 *
 * TWO seeded companies, because Garajım sells to two shapes of business and a
 * demo that can only show one of them is half a demo:
 *
 *   DEMO — Akdeniz Filo Kiralama   `rental`  17 vehicles, Antalya.
 *          Customers, contracts, handover/return km, and vehicles that are late
 *          back — which is what a rental company's morning actually revolves
 *          around.
 *   DEMO — Efes Kurye ve Dağıtım   `fleet`   7 vehicles, İzmir.
 *          Own-fleet courier: vehicles handed to employee drivers, with open
 *          assignments, idle vehicles and closed assignments in the history.
 *
 * Used for two jobs:
 *
 *   1. Selling. Both fleets look like a real Turkish company on a real Tuesday
 *      — a few things overdue, a few due this month, one van obviously bleeding
 *      money, and drivers whose routes the manager can see.
 *   2. App Review. Guideline 2.1(a) requires demo credentials for any app with
 *      a login, and Garajım's fleet half is invisible without an org membership
 *      (docs/fleet-design.md §1). Without this account a reviewer sees the
 *      consumer app and nothing else.
 *
 * Properties this script guarantees:
 *
 *   IDEMPOTENT   Every row it writes carries a `demo-` id or a @garajim.example
 *                address. A re-run deletes exactly those and rebuilds them, so
 *                running it twice gives the same fleets, not four.
 *   MARKED       Both orgs are named "DEMO — …", every id starts with `demo-`,
 *                and every account is on the reserved `.example` TLD. It cannot
 *                be mistaken for a real customer, and it cannot delete one.
 *   DATE-RELATIVE Every date is computed from the day you run it, so the triage
 *                board tells the same story in six months' time. The ONE
 *                exception is fuel prices — see FUEL_PRICES_SET_ON below.
 *
 * Usage:
 *   node scripts/seed-demo-fleet.mjs --yes [--migrate] [--db <path>]
 *   node scripts/seed-demo-fleet.mjs --yes --allow-nonempty        # real DB
 *   node scripts/seed-demo-fleet.mjs --yes --password '<new pw>'   # rotate
 *   node scripts/seed-demo-fleet.mjs --wipe --yes                  # remove it
 *
 * Options:
 *   --yes              Required. Nothing runs without it.
 *   --allow-nonempty   Also required when the target database already holds
 *                      non-demo users or organizations — i.e. production.
 *   --password <pw>    Password for every demo account. Rotate this before
 *                      sending credentials to App Store Connect.
 *   --wipe             Delete both demo orgs, the accounts and the uploads.
 *   --db <path>        Default $DATABASE_PATH, else <repo>/data/app.db
 *   --uploads <dir>    Default $UPLOADS_DIR, else <repo>/data/uploads
 *   --migrate          Apply pending migrations first (scratch databases)
 *   --no-verify        Skip the read-back report at the end
 *
 * Production (the image ships neither scripts/ nor a shell for the `node` user
 * to install one, so copy the directory in first):
 *
 *   docker cp scripts mototracker-api:/app/scripts
 *   docker exec -u node mototracker-api node /app/scripts/seed-demo-fleet.mjs \
 *     --yes --allow-nonempty --password "$DEMO_PW"
 *
 * On placeholder documents: we cannot ship real ruhsat/poliçe scans — they are
 * identity documents. Each demo document is therefore a GENERATED image that
 * says so on its face ("DEMO DATA - PLACEHOLDER - NOT A REAL SCAN") and prints
 * the same fields the row claims. Where a document carries an extraction, that
 * extraction is exactly the text drawn on the image, and `ocr_model` records
 * `demo-seed` rather than a model name — nothing here pretends OCR ran.
 *
 * On vehicle photos: `bike.photo_url` is deliberately left NULL on every demo
 * vehicle. We have no licensed photographs and will not ship fake ones; the
 * fleet API does not carry a photo field at all (`FleetInventoryRow`), and the
 * consumer screens fall back to the vehicle-type glyph (`vehicleIcon`). A clean
 * car/motorcycle icon grid demos better than seventeen identical grey plates.
 */
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  OperatorError,
  apiRequire,
  assertSchema,
  createOrganization,
  deleteOrganization,
  ensureSchema,
  ok,
  openDb,
  parseArgs,
  resolveDbPath,
  resolveUploadsDir,
  say,
  upsertMember,
  warn,
} from "./fleet-admin.mjs";

const bail = (m) => {
  throw new OperatorError(m);
};

// ─── identity of the demo data ───────────────────────────────────────────────

const EMAIL_DOMAIN = "garajim.example"; // .example is reserved by IANA: nobody can own it.
const DEFAULT_PASSWORD = "GarajimDemo2026!";

const RENTAL_ORG = {
  id: "demo-fleet-org",
  name: "DEMO — Akdeniz Filo Kiralama",
  mode: "rental",
  ceiling: 25,
};
const COURIER_ORG = {
  id: "demo-courier-org",
  name: "DEMO — Efes Kurye ve Dağıtım",
  mode: "fleet",
  ceiling: 12,
};
const ORGS = [RENTAL_ORG, COURIER_ORG];

/** How far back the operating history goes. Matches /fleet/costs' 12-month default. */
const WINDOW_DAYS = 365;

/**
 * The accounts. The owner and the manager belong to BOTH organizations, so one
 * sign-in demonstrates the org switcher and both product modes; the drivers
 * belong to exactly one org and hold exactly one vehicle, which is what makes
 * "a driver sees only their vehicle" a clean thing to show.
 */
const PEOPLE = [
  { key: "owner", email: `demo@${EMAIL_DOMAIN}`, name: "Ayşe Yıldırım", memberships: [["demo-fleet-org", "owner"], ["demo-courier-org", "owner"]] },
  { key: "manager", email: `demo.mudur@${EMAIL_DOMAIN}`, name: "Mehmet Demir", memberships: [["demo-fleet-org", "manager"], ["demo-courier-org", "manager"]] },
  { key: "staff", email: `demo.ofis@${EMAIL_DOMAIN}`, name: "Zeynep Kaya", memberships: [["demo-fleet-org", "staff"]] },
  { key: "driver", email: `demo.sofor@${EMAIL_DOMAIN}`, name: "Emre Şahin", memberships: [["demo-fleet-org", "driver"]] },
  { key: "kurye1", email: `demo.kurye1@${EMAIL_DOMAIN}`, name: "Okan Bulut", memberships: [["demo-courier-org", "driver"]] },
  { key: "kurye2", email: `demo.kurye2@${EMAIL_DOMAIN}`, name: "Deniz Acar", memberships: [["demo-courier-org", "driver"]] },
  { key: "kurye3", email: `demo.kurye3@${EMAIL_DOMAIN}`, name: "Sinem Yalçın", memberships: [["demo-courier-org", "driver"]] },
];

/** Printed prominently: the two accounts a demo or a reviewer actually needs. */
const HEADLINE_ACCOUNTS = ["owner", "driver"];

// ─── fuel prices ─────────────────────────────────────────────────────────────

/**
 * ₺ per litre. THE ONLY THING IN THIS FILE THAT IS NOT DATE-RELATIVE, so it is
 * the only thing that goes stale: everything else recomputes from the day you
 * run the seeder, but a pump price from two years ago just reads as wrong to a
 * Turkish prospect who buys diesel every week.
 *
 * REFRESH THESE and move the date when they drift. The run warns you when they
 * are more than FUEL_PRICE_STALE_DAYS old, so this is a one-line update rather
 * than something to go hunting for.
 */
const FUEL_PRICES_SET_ON = "2026-08-17";
const FUEL_PRICE_STALE_DAYS = 180;
const FUEL_PRICE = {
  Benzin: 52.4,
  Dizel: 53.8,
  Hibrit: 52.4, // a hybrid still fills up with petrol.
};

// ─── the rental fleet (Antalya) ──────────────────────────────────────────────
//
// Makes and models are taken from apps/api/src/db/seed/vehicleCatalog.generated.ts
// so the UI's make/model resolution finds them. Plates use the real province
// codes 07 Antalya (the company's base), 34 İstanbul, 35 İzmir, 48 Muğla.
// `km0` is the odometer WINDOW_DAYS ago; today's reading is derived.

const RENTAL_VEHICLES = [
  { k: "egea",     t: "car", mk: "Fiat", md: "Egea", yr: 2022, plate: "07 ACD 512", color: "Beyaz", fuel: "Dizel", km0: 61_000, kpd: 95, l100: 4.9, tank: 50 },
  { k: "clio",     t: "car", mk: "Renault", md: "Clio", yr: 2023, plate: "07 BFN 214", color: "Gri", fuel: "Benzin", km0: 34_500, kpd: 88, l100: 5.6, tank: 45 },
  { k: "symbol",   t: "car", mk: "Renault", md: "Symbol", yr: 2021, plate: "07 CH 4180", color: "Beyaz", fuel: "Benzin", km0: 88_400, kpd: 92, l100: 6.0, tank: 50 },
  { k: "i20",      t: "car", mk: "Hyundai", md: "i20", yr: 2023, plate: "07 DK 337", color: "Mavi", fuel: "Benzin", km0: 29_700, kpd: 85, l100: 5.8, tank: 40 },
  { k: "polo",     t: "car", mk: "Volkswagen", md: "Polo", yr: 2022, plate: "07 EMR 760", color: "Beyaz", fuel: "Benzin", km0: 46_200, kpd: 80, l100: 5.5, tank: 45 },
  { k: "corolla",  t: "car", mk: "Toyota", md: "Corolla", yr: 2023, plate: "07 FT 2094", color: "Siyah", fuel: "Hibrit", km0: 38_900, kpd: 105, l100: 4.3, tank: 43 },
  { k: "p301",     t: "car", mk: "Peugeot", md: "301", yr: 2021, plate: "07 GS 118", color: "Gri", fuel: "Dizel", km0: 102_300, kpd: 98, l100: 4.6, tank: 50 },
  { k: "duster",   t: "car", mk: "Dacia", md: "Duster", yr: 2022, plate: "07 HN 5521", color: "Kahverengi", fuel: "Dizel", km0: 57_800, kpd: 90, l100: 5.4, tank: 50 },
  { k: "doblo",    t: "car", mk: "Fiat", md: "Doblo", yr: 2020, plate: "07 JR 806", color: "Beyaz", fuel: "Dizel", km0: 131_500, kpd: 70, l100: 6.2, tank: 60 },
  { k: "transit",  t: "car", mk: "Ford", md: "Transit Custom", yr: 2019, plate: "34 KLM 226", color: "Beyaz", fuel: "Dizel", km0: 268_400, kpd: 120, l100: 11.8, tank: 70 },
  { k: "elysee",   t: "car", mk: "Citroën", md: "C-Elysée", yr: 2020, plate: "07 MB 4407", color: "Gri", fuel: "Dizel", km0: 118_600, kpd: 94, l100: 4.7, tank: 50 },
  { k: "corsa",    t: "car", mk: "Opel", md: "Corsa", yr: 2023, plate: "35 NRT 640", color: "Kırmızı", fuel: "Benzin", km0: 24_300, kpd: 78, l100: 5.7, tank: 40 },
  { k: "vito",     t: "car", mk: "Mercedes-Benz", md: "Vito", yr: 2022, plate: "07 PS 1907", color: "Siyah", fuel: "Dizel", km0: 79_200, kpd: 96, l100: 8.4, tank: 70 },
  { k: "pcx",      t: "motorcycle", mk: "Honda", md: "PCX125", yr: 2023, plate: "07 RD 215", color: "Mat Siyah", fuel: "Benzin", cc: 125, km0: 11_800, kpd: 45, l100: 2.4, tank: 8 },
  { k: "nmax",     t: "motorcycle", mk: "Yamaha", md: "NMAX 125", yr: 2022, plate: "07 SB 990", color: "Mavi", fuel: "Benzin", cc: 125, km0: 18_900, kpd: 42, l100: 2.5, tank: 7 },
  { k: "vespa",    t: "motorcycle", mk: "Vespa", md: "Primavera 125", yr: 2021, plate: "07 TK 443", color: "Bej", fuel: "Benzin", cc: 125, km0: 22_400, kpd: 38, l100: 2.3, tank: 8 },
  { k: "symphony", t: "motorcycle", mk: "SYM", md: "Symphony SR 125", yr: 2022, plate: "48 UY 317", color: "Beyaz", fuel: "Benzin", cc: 125, km0: 16_700, kpd: 40, l100: 2.6, tank: 7 },
];

/**
 * The compliance story the triage board must tell: three genuinely overdue
 * items on three different vehicles, several due inside the next month,
 * everything else comfortably healthy. `d` is days from today — negative is
 * overdue.
 *
 * The overdue MTV is the July instalment (Türkiye collects MTV in January and
 * July), which is the most believable thing for a busy fleet to miss.
 */
const RENTAL_STORY = {
  transit: { mtv: -17 },
  symbol: { sigorta: -5 },
  vespa: { muayene: -24 },
  vito: { kasko: 4 },
  egea: { sigorta: 9 },
  duster: { sigorta: 12 },
  polo: { muayene: 17 },
  pcx: { sigorta: 21 },
  elysee: { muayene: 29 },
};

/**
 * Service history over the whole window. `[kind, daysAgo, ₺, customLabel?]`.
 *
 * The Transit's list is the point of the costs screen: an eight-year-old van
 * whose service bill in one year dwarfs everything else in the fleet.
 */
const RENTAL_SERVICE = {
  egea: [["engine_oil", 41, 3200], ["air_filter", 41, 950], ["brakes", 96, 5400], ["engine_oil", 232, 3050], ["tires", 301, 16_900]],
  clio: [["engine_oil", 63, 2900], ["tires", 128, 14_800], ["engine_oil", 254, 2780], ["battery", 336, 3900]],
  symbol: [["engine_oil", 22, 2750], ["battery", 74, 4100], ["brakes", 149, 4900], ["engine_oil", 219, 2680], ["tires", 288, 15_400]],
  i20: [["engine_oil", 88, 2850], ["engine_oil", 271, 2740], ["brakes", 194, 4600]],
  polo: [["engine_oil", 35, 3100], ["tires", 112, 16_200], ["engine_oil", 243, 2980], ["air_filter", 243, 980]],
  corolla: [["engine_oil", 57, 3600], ["air_filter", 57, 1100], ["engine_oil", 249, 3450], ["brakes", 318, 6200]],
  p301: [["engine_oil", 15, 3050], ["brakes", 81, 5850], ["custom", 137, 9800, "Triger seti değişimi"], ["engine_oil", 206, 2960], ["tires", 297, 15_800]],
  duster: [["engine_oil", 47, 3400], ["tires", 102, 18_400], ["engine_oil", 238, 3260], ["brakes", 311, 6400]],
  doblo: [["engine_oil", 29, 3250], ["battery", 66, 4400], ["brakes", 121, 6100], ["engine_oil", 226, 3120], ["tires", 292, 17_200]],
  transit: [
    ["engine_oil", 12, 4200],
    ["custom", 26, 42_500, "Debriyaj seti + volan değişimi"],
    ["brakes", 44, 11_800],
    ["custom", 58, 7600, "Enjektör temizliği"],
    ["tires", 71, 24_600],
    ["engine_oil", 94, 4050],
    ["custom", 133, 28_900, "Turbo revizyonu"],
    ["engine_oil", 191, 3980],
    ["tires", 214, 23_800],
    ["brakes", 263, 9800],
    ["custom", 302, 31_000, "Şanzıman revizyonu"],
    ["custom", 341, 6400, "Rot-balans + fren hidroliği"],
  ],
  elysee: [["engine_oil", 51, 3150], ["brakes", 139, 5200], ["engine_oil", 247, 3020], ["tires", 329, 15_100]],
  corsa: [["engine_oil", 79, 2800], ["engine_oil", 268, 2690], ["air_filter", 268, 920]],
  vito: [["engine_oil", 33, 4800], ["air_filter", 33, 1350], ["tires", 118, 22_400], ["engine_oil", 236, 4650], ["brakes", 305, 8900]],
  pcx: [["engine_oil", 44, 850], ["tires", 130, 3400], ["engine_oil", 241, 810]],
  nmax: [["engine_oil", 68, 820], ["brakes", 145, 1900], ["engine_oil", 259, 790]],
  vespa: [["engine_oil", 25, 890], ["engine_oil", 218, 860], ["tires", 296, 3600]],
  symphony: [["engine_oil", 59, 780], ["tires", 124, 3100], ["engine_oil", 251, 760]],
};

const CUSTOMERS = [
  { k: "yilmaz", name: "Ahmet Yılmaz", phone: "+90 532 214 88 31", email: "ahmet.yilmaz@example.com" },
  { k: "demir", name: "Elif Demir", phone: "+90 505 663 12 09", email: "elif.demir@example.com" },
  { k: "celik", name: "Mustafa Çelik", phone: "+90 542 890 44 17", email: "mustafa.celik@example.com" },
  { k: "sahin", name: "Fatma Şahin", phone: "+90 533 471 20 65", email: "fatma.sahin@example.com" },
  { k: "ozturk", name: "Burak Öztürk", phone: "+90 536 118 73 92", email: "burak.ozturk@example.com" },
  { k: "arslan", name: "Selin Arslan", phone: "+90 538 902 51 44", email: "selin.arslan@example.com" },
  { k: "koc", name: "Hakan Koç", phone: "+90 507 335 60 28", email: "hakan.koc@example.com" },
  { k: "aydin", name: "Merve Aydın", phone: "+90 544 226 19 73", email: "merve.aydin@example.com" },
  { k: "lara", name: "Lara Turizm Ltd. Şti.", phone: "+90 242 324 55 10", email: "filo@laraturizm.example", notes: "Kurumsal — aylık faturalı, 3 araç kotası." },
  { k: "insaat", name: "Konyaaltı İnşaat A.Ş.", phone: "+90 242 259 80 04", email: "satinalma@konyaaltiinsaat.example", notes: "Kurumsal — şantiye transferi, uzun dönem." },
];

/**
 * Open rentals: `start` days ago, agreed back after `days`.
 *
 * The last three are the ones that matter most on the board. A vehicle that has
 * not come back is the rental business's daily emergency, and it reaches the
 * triage board through the same path as an expired policy — orgFleet.ts adds an
 * open contract's `ends_at` as a `contract_due` deadline, so a late return is
 * rendered `expired`, in red, with the same days-overdue treatment. One is 12
 * days gone, one 3, and one tipped over yesterday.
 */
const OPEN_CONTRACTS = [
  { v: "clio", c: "yilmaz", start: 4, days: 10, rate: 1450 },
  { v: "i20", c: "demir", start: 2, days: 7, rate: 1500 },
  { v: "corolla", c: "lara", start: 11, days: 30, rate: 2200 },
  { v: "corsa", c: "arslan", start: 6, days: 14, rate: 1400 },
  { v: "vito", c: "koc", start: 9, days: 12, rate: 3400 },
  { v: "egea", c: "celik", start: 1, days: 5, rate: 1350 },
  { v: "transit", c: "insaat", start: 24, days: 90, rate: 3900, notes: "Uzun dönem şantiye kirası." },
  // ── late back ──
  { v: "p301", c: "aydin", start: 38, days: 26, rate: 1300, notes: "İade gecikti — müşteriye 3 kez ulaşıldı, telefon kapalı." },
  { v: "duster", c: "sahin", start: 20, days: 17, rate: 1750, notes: "İade gecikti — müşteri uzatma talep etti, sözleşme güncellenmedi." },
  { v: "nmax", c: "ozturk", start: 6, days: 5, rate: 800, notes: "İade dün akşam bekleniyordu." },
];

/** Closed rentals, oldest first. `start` is days ago; back after `days`. */
const CLOSED_CONTRACTS = [
  { v: "polo", c: "aydin", start: 351, days: 11, rate: 1250 },
  { v: "egea", c: "koc", start: 334, days: 7, rate: 1200 },
  { v: "vespa", c: "arslan", start: 318, days: 4, rate: 780 },
  { v: "symbol", c: "yilmaz", start: 299, days: 18, rate: 1150 },
  { v: "corolla", c: "insaat", start: 277, days: 30, rate: 2050 },
  { v: "clio", c: "sahin", start: 254, days: 9, rate: 1280 },
  { v: "pcx", c: "demir", start: 231, days: 5, rate: 860 },
  { v: "vito", c: "lara", start: 214, days: 12, rate: 3200 },
  { v: "duster", c: "celik", start: 196, days: 14, rate: 1700 },
  { v: "elysee", c: "ozturk", start: 172, days: 9, rate: 1200 },
  { v: "symphony", c: "aydin", start: 158, days: 6, rate: 720 },
  { v: "i20", c: "yilmaz", start: 141, days: 8, rate: 1450 },
  { v: "corsa", c: "koc", start: 133, days: 21, rate: 1330 },
  { v: "p301", c: "lara", start: 118, days: 30, rate: 1300 },
  { v: "nmax", c: "sahin", start: 104, days: 6, rate: 790 },
  { v: "polo", c: "arslan", start: 92, days: 12, rate: 1400 },
  { v: "symbol", c: "demir", start: 77, days: 4, rate: 1200 },
  { v: "elysee", c: "celik", start: 63, days: 16, rate: 1250 },
  { v: "vespa", c: "insaat", start: 51, days: 30, rate: 850 },
  { v: "symphony", c: "sahin", start: 38, days: 7, rate: 750 },
  { v: "pcx", c: "ozturk", start: 26, days: 9, rate: 900 },
  { v: "clio", c: "aydin", start: 17, days: 6, rate: 1350 },
];

/** `[vehicle, docType, ocrStatus]`. Three stay pending on purpose. */
const RENTAL_DOCS = [
  ["egea", "ruhsat", "done"], ["clio", "ruhsat", "done"], ["transit", "ruhsat", "done"],
  ["vito", "ruhsat", "done"], ["pcx", "ruhsat", "done"], ["corolla", "ruhsat", "pending"],
  ["egea", "sigorta", "done"], ["symbol", "sigorta", "done"], ["duster", "sigorta", "pending"],
  ["polo", "muayene", "done"], ["vespa", "muayene", "done"], ["elysee", "muayene", "pending"],
];

// ─── the courier fleet (İzmir) ───────────────────────────────────────────────
//
// The own-fleet half of the market: scooters and small vans handed to employee
// drivers. Smaller on purpose — a courier firm with seven vehicles is exactly
// the customer this mode is sold to.

const COURIER_VEHICLES = [
  { k: "kpcx",     t: "motorcycle", mk: "Honda", md: "PCX125", yr: 2023, plate: "35 ABK 417", color: "Kırmızı", fuel: "Benzin", cc: 125, km0: 9400, kpd: 78, l100: 2.5, tank: 8 },
  { k: "knmax",    t: "motorcycle", mk: "Yamaha", md: "NMAX 125", yr: 2022, plate: "35 BCD 908", color: "Gri", fuel: "Benzin", cc: 125, km0: 21_600, kpd: 74, l100: 2.6, tank: 7 },
  { k: "ksym",     t: "motorcycle", mk: "SYM", md: "Symphony SR 125", yr: 2023, plate: "35 CT 5512", color: "Beyaz", fuel: "Benzin", cc: 125, km0: 7300, kpd: 69, l100: 2.7, tank: 7 },
  // The pool scooter. Fuel logging stops partway through the year — see FUEL_STOPS.
  { k: "kkuba",    t: "motorcycle", mk: "Kuba", md: "Superlight 125", yr: 2021, plate: "35 DR 224", color: "Siyah", fuel: "Benzin", cc: 125, km0: 33_800, kpd: 24, l100: 2.9, tank: 8 },
  { k: "fiorino",  t: "car", mk: "Fiat", md: "Fiorino", yr: 2021, plate: "35 EN 1180", color: "Beyaz", fuel: "Dizel", km0: 96_500, kpd: 88, l100: 5.6, tank: 45 },
  { k: "kcourier", t: "car", mk: "Ford", md: "Courier", yr: 2022, plate: "35 FP 730", color: "Beyaz", fuel: "Dizel", km0: 61_200, kpd: 92, l100: 5.9, tank: 50 },
  { k: "partner",  t: "car", mk: "Peugeot", md: "Partner", yr: 2020, plate: "35 GH 6604", color: "Gri", fuel: "Dizel", km0: 141_900, kpd: 84, l100: 6.4, tank: 50 },
];

/**
 * Vehicles whose fuel logging STOPPED `n` days ago, and why.
 *
 * `35 DR 224` is the pool scooter: anyone can take it, and since the firm put
 * its fuel on a company card nobody enters the receipts any more. That gap is
 * extremely common in real fleets, and it is the only honest way to demo the
 * thing /fleet/costs does about it — with no odometer trail for those months it
 * falls back to GPS trip distance rather than reporting a blank or a guess.
 *
 * The trips that cover the gap are generated by POOL_ROUNDS below, so the
 * fallback has real distance to work with instead of a token sample.
 */
const FUEL_STOPS = { kkuba: 65 };

const COURIER_STORY = {
  fiorino: { muayene: -8 },
  kpcx: { sigorta: 6 },
  kcourier: { kasko: 19 },
  knmax: { muayene: 25 },
};

const COURIER_SERVICE = {
  kpcx: [["engine_oil", 31, 880], ["tires", 118, 3500], ["engine_oil", 224, 840]],
  knmax: [["engine_oil", 19, 860], ["brakes", 96, 1950], ["engine_oil", 212, 820], ["tires", 288, 3300]],
  ksym: [["engine_oil", 52, 800], ["engine_oil", 247, 770]],
  kkuba: [["engine_oil", 38, 760], ["brakes", 141, 1700], ["engine_oil", 236, 730], ["tires", 305, 2900]],
  fiorino: [["engine_oil", 27, 3300], ["brakes", 109, 6200], ["engine_oil", 221, 3180], ["tires", 284, 17_600]],
  kcourier: [["engine_oil", 44, 3450], ["air_filter", 44, 1020], ["engine_oil", 239, 3300], ["tires", 312, 18_200]],
  // The courier fleet's own problem vehicle: a 2020 van past 170.000 km, whose
  // service bill is what makes its ₺/km the highest of the seven.
  partner: [
    ["engine_oil", 16, 3150], ["battery", 87, 4300], ["brakes", 158, 5900],
    ["engine_oil", 203, 3040], ["custom", 271, 11_400, "Debriyaj seti değişimi"],
    ["custom", 61, 18_700, "Turbo revizyonu"], ["tires", 129, 16_400],
    ["custom", 318, 8200, "Rot-balans + süspansiyon"],
  ],
};

/**
 * Who is holding what. Open assignments have no `end`; a closed one leaves the
 * history a manager can read on the vehicle page — the whole point of keeping
 * assignment rows rather than a "current driver" column.
 *
 * Three of seven vehicles are out, four are idle: a courier firm at 10am.
 */
const COURIER_ASSIGNMENTS = [
  { v: "kpcx", by: "kurye1", start: 96 },
  { v: "fiorino", by: "kurye2", start: 143 },
  { v: "kcourier", by: "kurye3", start: 28 },
  // Closed — Okan was on the NMAX before he moved to the PCX.
  { v: "knmax", by: "kurye1", start: 214, end: 97 },
  // Closed — a two-week cover while the Fiorino was in for its clutch.
  { v: "partner", by: "kurye2", start: 47, end: 33 },
  // The pool scooter, handed round and handed back. Three short holds in a row
  // is what a shared vehicle's history actually looks like, and it is what lets
  // every one of its trips be attributed to whoever was holding it that day.
  { v: "kkuba", by: "kurye3", start: 64, end: 44 },
  { v: "kkuba", by: "kurye1", start: 43, end: 22 },
  { v: "kkuba", by: "kurye2", start: 21, end: 4 },
];

const COURIER_DOCS = [
  ["kpcx", "ruhsat", "done"], ["fiorino", "ruhsat", "done"], ["kcourier", "sigorta", "done"],
  ["partner", "muayene", "pending"],
];

// ─── routes ──────────────────────────────────────────────────────────────────
//
// Real corridors, described by waypoints taken off the roads they follow: the
// D400 coast road west out of Antalya, the D400 east towards Belek, and three
// İzmir arteries. Points between waypoints are interpolated at ~120 m with a
// few metres of lateral jitter, which is what a client-simplified GPS trace
// looks like — not a straight line, and not noise wandering into the sea.

const ROUTES = {
  // D400 west: Antalya merkez → Konyaaltı → Beldibi → Kemer.
  antalya_kemer: {
    label: "Antalya → Kemer (D400)",
    kmh: 62,
    points: [
      [36.8865, 30.7050], [36.8710, 30.6660], [36.8605, 30.6280], [36.8380, 30.5940],
      [36.8035, 30.5730], [36.7640, 30.5520], [36.7190, 30.5300], [36.6720, 30.5310],
      [36.6360, 30.5470], [36.6021, 30.5606],
    ],
  },
  // D400 east: merkez → Aksu → Kadriye → Belek.
  antalya_belek: {
    label: "Antalya → Belek (D400)",
    kmh: 68,
    points: [
      [36.8869, 30.7050], [36.8918, 30.7460], [36.8975, 30.7930], [36.9008, 30.8380],
      [36.8930, 30.8960], [36.8790, 30.9600], [36.8660, 31.0180], [36.8620, 31.0550],
    ],
  },
  // Airport transfer: AYT → Lara sahil → merkez.
  antalya_lara: {
    label: "Antalya Havalimanı → Lara → merkez",
    kmh: 48,
    points: [
      [36.8987, 30.7930], [36.8880, 30.8010], [36.8720, 30.8180], [36.8570, 30.8130],
      [36.8520, 30.7830], [36.8600, 30.7480], [36.8760, 30.7180], [36.8869, 30.7050],
    ],
  },
  // İzmir: Konak → Alsancak → Bayraklı → Karşıyaka → Çiğli → Sasalı, around the
  // bay. Long enough to clear MIN_TRIP_KM (15 km) — the API refuses anything
  // shorter, so a seeded trip below it could never have been recorded for real.
  izmir_cigli: {
    label: "Konak → Karşıyaka → Çiğli → Sasalı",
    kmh: 34,
    points: [
      [38.4189, 27.1287], [38.4310, 27.1420], [38.4460, 27.1520], [38.4560, 27.1330],
      [38.4570, 27.1120], [38.4700, 27.0930], [38.4860, 27.0740], [38.4950, 27.0640],
      [38.5060, 27.0380], [38.5150, 27.0130],
    ],
  },
  // İzmir: Konak → Bornova → Işıkkent → Kemalpaşa (D300 corridor).
  izmir_kemalpasa: {
    label: "Konak → Bornova → Kemalpaşa",
    kmh: 41,
    points: [
      [38.4189, 27.1287], [38.4310, 27.1560], [38.4420, 27.1810], [38.4610, 27.2170],
      [38.4530, 27.2560], [38.4460, 27.2960], [38.4380, 27.3520], [38.4300, 27.4100],
    ],
  },
  // A whole day's deliveries recorded as one trip, which is what happens when a
  // courier starts tracking in the morning and stops in the evening: up the bay
  // to Çiğli, back through Bornova and Buca, home to Konak. ~47 km.
  izmir_gunluk_tur: {
    label: "İzmir günlük dağıtım turu",
    kmh: 27,
    points: [
      [38.4189, 27.1287], [38.4310, 27.1420], [38.4460, 27.1520], [38.4570, 27.1120],
      [38.4950, 27.0640], [38.4570, 27.1120], [38.4460, 27.1520], [38.4610, 27.2170],
      [38.4460, 27.2500], [38.3860, 27.1760], [38.4189, 27.1287],
    ],
  },
  // İzmir: Konak → Şirinyer → Gaziemir → Torbalı (D550 south).
  izmir_torbali: {
    label: "Konak → Gaziemir → Torbalı",
    kmh: 46,
    points: [
      [38.4189, 27.1287], [38.4020, 27.1230], [38.3760, 27.1180], [38.3480, 27.1210],
      [38.3200, 27.1300], [38.2830, 27.1620], [38.2380, 27.2260], [38.1960, 27.2960],
      [38.1600, 27.3550],
    ],
  },
};

/**
 * Which vehicle ran what, when, and who was carrying the phone.
 *
 * `by` is the recorder — and it is the honest one: a courier's route is
 * recorded by the courier, and a manager can then see it. That is exactly the
 * disclosure the KVKK section describes, so the demo should make it concrete
 * rather than abstract.
 */
const TRIPS = [
  // Rental org: the transfer van and the service van. Renters' own driving is
  // never tracked — a rental customer's phone is not ours to record from.
  { org: "rental", v: "vito", by: "staff", route: "antalya_lara", d: 3, h: 9 },
  { org: "rental", v: "vito", by: "staff", route: "antalya_lara", d: 8, h: 14 },
  { org: "rental", v: "vito", by: "staff", route: "antalya_belek", d: 16, h: 7 },
  { org: "rental", v: "doblo", by: "driver", route: "antalya_kemer", d: 2, h: 8 },
  { org: "rental", v: "doblo", by: "driver", route: "antalya_lara", d: 5, h: 11 },
  { org: "rental", v: "doblo", by: "driver", route: "antalya_kemer", d: 12, h: 16 },
  { org: "rental", v: "doblo", by: "driver", route: "antalya_belek", d: 19, h: 9 },
  { org: "rental", v: "doblo", by: "driver", route: "antalya_lara", d: 27, h: 13 },
  { org: "rental", v: "doblo", by: "driver", route: "antalya_kemer", d: 34, h: 8 },

  // Courier org: this is the whole job.
  { org: "courier", v: "kpcx", by: "kurye1", route: "izmir_cigli", d: 1, h: 9 },
  { org: "courier", v: "kpcx", by: "kurye1", route: "izmir_kemalpasa", d: 2, h: 10 },
  { org: "courier", v: "kpcx", by: "kurye1", route: "izmir_cigli", d: 4, h: 8 },
  { org: "courier", v: "kpcx", by: "kurye1", route: "izmir_torbali", d: 7, h: 13 },
  { org: "courier", v: "kpcx", by: "kurye1", route: "izmir_cigli", d: 11, h: 9 },
  { org: "courier", v: "fiorino", by: "kurye2", route: "izmir_torbali", d: 1, h: 7 },
  { org: "courier", v: "fiorino", by: "kurye2", route: "izmir_kemalpasa", d: 3, h: 12 },
  { org: "courier", v: "fiorino", by: "kurye2", route: "izmir_torbali", d: 6, h: 8 },
  { org: "courier", v: "fiorino", by: "kurye2", route: "izmir_cigli", d: 10, h: 15 },
  { org: "courier", v: "kcourier", by: "kurye3", route: "izmir_kemalpasa", d: 2, h: 8 },
  { org: "courier", v: "kcourier", by: "kurye3", route: "izmir_torbali", d: 5, h: 9 },
  { org: "courier", v: "kcourier", by: "kurye3", route: "izmir_kemalpasa", d: 9, h: 14 },
  // Recorded before Okan handed the NMAX back — visible in its history.
  { org: "courier", v: "knmax", by: "kurye1", route: "izmir_cigli", d: 104, h: 9 },
  { org: "courier", v: "knmax", by: "kurye1", route: "izmir_kemalpasa", d: 112, h: 10 },
];

/**
 * The pool scooter's daily rounds, generated rather than listed: one tracked
 * round every other working day across exactly the window where its fuel logs
 * stop. That is what makes the ₺/km the costs screen falls back to a real
 * number — a handful of sample trips against a year of premiums would produce
 * an absurd figure and demo as a bug.
 *
 * The recorder is resolved from whoever held the vehicle that day, so no trip
 * exists that its author could not have created through the API.
 */
const POOL_ROUNDS = {
  org: "courier",
  v: "kkuba",
  route: "izmir_gunluk_tur",
  fromDay: 64,
  toDay: 2,
  everyDays: 2,
  hour: 8,
};

const SIGORTA_PROVIDERS = [
  "Anadolu Sigorta", "Axa Sigorta", "Allianz Türkiye", "Ak Sigorta",
  "HDI Sigorta", "Sompo Sigorta", "Türkiye Sigorta", "Ray Sigorta",
];

/**
 * How long before its expiry each kind of paper was bought. `/fleet/costs`
 * buckets compliance spend by `dated_item.created_at` (there is no separate
 * purchase date), so leaving these at "now" would pile a year of premiums into
 * the current month and flatten every other month on the chart.
 *
 * Commercial vehicles are inspected annually in Türkiye, hence 365 for muayene;
 * MTV is two instalments a year, hence 182.
 */
const POLICY_TERM_DAYS = { sigorta: 365, kasko: 365, muayene: 365, mtv: 182 };

// ─── date + number helpers ───────────────────────────────────────────────────

const TODAY = new Date();
/** ISO date (YYYY-MM-DD) `n` days from today; negative is the past. */
function isoDay(n) {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function isoStamp(n, hour = null) {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + n);
  if (hour !== null) d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString().slice(0, 19).replace("T", " ");
}
/** `days` before an ISO date, as a datetime — for a policy's purchase date. */
function isoStampBefore(isoDate, days) {
  const d = new Date(`${isoDate}T10:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 19).replace("T", " ");
}
/** Next 31 January — the MTV instalment every compliant vehicle is waiting on. */
function nextJanuaryMtv() {
  const y = TODAY.getUTCMonth() >= 1 ? TODAY.getUTCFullYear() + 1 : TODAY.getUTCFullYear();
  return `${y}-01-31`;
}
const round2 = (n) => Math.round(n * 100) / 100;
const daysSince = (isoDate) => Math.round((TODAY - new Date(`${isoDate}T00:00:00Z`)) / 86_400_000);

/** Deterministic PRNG, so two runs produce byte-identical data. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Odometer of `v` `daysAgo` days ago. kmAt(v, 0) is today's reading. */
const kmAt = (v, daysAgo) => Math.round(v.km0 + v.kpd * (WINDOW_DAYS - daysAgo));

// ─── routes: geometry and encoding ───────────────────────────────────────────
//
// The polyline algorithm is Google's, at 1e-5 precision — the same one
// apps/web/src/lib/polyline.ts implements for the client. It is reimplemented
// here rather than imported: a script in scripts/ must not reach across into
// the web app's source, and the encoding is a frozen wire format anyway.

function encodeValue(value, out) {
  let v = value < 0 ? ~(value << 1) : value << 1;
  while (v >= 0x20) {
    out.push(String.fromCharCode((0x20 | (v & 0x1f)) + 63));
    v >>= 5;
  }
  out.push(String.fromCharCode(v + 63));
}

function encodePolyline(points) {
  const out = [];
  let prevLat = 0;
  let prevLng = 0;
  for (const [lat, lng] of points) {
    const iLat = Math.round(lat * 1e5);
    const iLng = Math.round(lng * 1e5);
    encodeValue(iLat - prevLat, out);
    encodeValue(iLng - prevLng, out);
    prevLat = iLat;
    prevLng = iLng;
  }
  return out.join("");
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Waypoints → a trace. Samples every ~`stepM` metres along each leg and offsets
 * each sample by a few metres perpendicular to the road, so the line reads as a
 * recorded track rather than as a drawn one. Deterministic: the jitter comes
 * from the caller's seeded PRNG.
 */
function traceRoute(waypoints, rand, { stepM = 120, jitterM = 7 } = {}) {
  const out = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const legKm = haversineKm(a, b);
    const steps = Math.max(1, Math.round((legKm * 1000) / stepM));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const lat = a[0] + (b[0] - a[0]) * t;
      const lng = a[1] + (b[1] - a[1]) * t;
      // Perpendicular unit vector in degrees, scaled to jitterM.
      const dLat = b[0] - a[0];
      const dLng = b[1] - a[1];
      const norm = Math.hypot(dLat, dLng) || 1;
      const offset = ((rand() - 0.5) * 2 * jitterM) / 111_320;
      out.push([
        round5(lat + (-dLng / norm) * offset),
        round5(lng + (dLat / norm) * offset / Math.cos((lat * Math.PI) / 180)),
      ]);
    }
  }
  out.push([round5(waypoints.at(-1)[0]), round5(waypoints.at(-1)[1])]);
  return out;
}

const round5 = (n) => Math.round(n * 1e5) / 1e5;

function traceLengthKm(points) {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1], points[i]);
  return km;
}

// ─── placeholder document images ─────────────────────────────────────────────
//
// Drawn from a built-in 5×7 bitmap font rather than a system font: the runtime
// image (node:20-bookworm-slim) ships no fonts at all, so anything that goes
// through pango/fontconfig renders blank there. This always renders.

const GLYPHS = {
  " ": [0, 0, 0, 0, 0], "-": [8, 8, 8, 8, 8], ".": [0, 96, 96, 0, 0], "/": [32, 16, 8, 4, 2],
  ":": [0, 54, 54, 0, 0], ",": [0, 80, 48, 0, 0], "(": [0, 28, 34, 65, 0], ")": [0, 65, 34, 28, 0],
  "#": [20, 127, 20, 127, 20], "*": [20, 8, 62, 8, 20],
  "0": [62, 81, 73, 69, 62], "1": [0, 66, 127, 64, 0], "2": [66, 97, 81, 73, 70], "3": [33, 65, 69, 75, 49],
  "4": [24, 20, 18, 127, 16], "5": [39, 69, 69, 69, 57], "6": [60, 74, 73, 73, 48], "7": [1, 113, 9, 5, 3],
  "8": [54, 73, 73, 73, 54], "9": [6, 73, 73, 41, 30],
  A: [126, 17, 17, 17, 126], B: [127, 73, 73, 73, 54], C: [62, 65, 65, 65, 34], D: [127, 65, 65, 34, 28],
  E: [127, 73, 73, 73, 65], F: [127, 9, 9, 1, 1], G: [62, 65, 65, 81, 50], H: [127, 8, 8, 8, 127],
  I: [0, 65, 127, 65, 0], J: [32, 64, 65, 63, 1], K: [127, 8, 20, 34, 65], L: [127, 64, 64, 64, 64],
  M: [127, 2, 4, 2, 127], N: [127, 4, 8, 16, 127], O: [62, 65, 65, 65, 62], P: [127, 9, 9, 9, 6],
  Q: [62, 65, 81, 33, 94], R: [127, 9, 25, 41, 70], S: [70, 73, 73, 73, 49], T: [1, 1, 127, 1, 1],
  U: [63, 64, 64, 64, 63], V: [31, 32, 64, 32, 31], W: [127, 32, 24, 32, 127], X: [99, 20, 8, 20, 99],
  Y: [3, 4, 120, 4, 3], Z: [97, 81, 73, 69, 67],
};

/** The font is ASCII; Turkish letters fold to their nearest Latin form. */
const FOLD = { Ç: "C", Ğ: "G", İ: "I", I: "I", Ö: "O", Ş: "S", Ü: "U", ç: "C", ğ: "G", ı: "I", ö: "O", ş: "S", ü: "U" };
const asciiUpper = (s) =>
  [...s].map((ch) => FOLD[ch] ?? ch).join("").toLocaleUpperCase("en-US").replace(/[^\x20-\x7E]/g, " ");

function makeCanvas(w, h, [r, g, b]) {
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    buf[i * 3] = r;
    buf[i * 3 + 1] = g;
    buf[i * 3 + 2] = b;
  }
  return { w, h, buf };
}
function fillRect(cv, x0, y0, w, h, [r, g, b]) {
  for (let y = y0; y < y0 + h; y++) {
    if (y < 0 || y >= cv.h) continue;
    for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || x >= cv.w) continue;
      const i = (y * cv.w + x) * 3;
      cv.buf[i] = r;
      cv.buf[i + 1] = g;
      cv.buf[i + 2] = b;
    }
  }
}
function drawText(cv, text, x0, y0, scale, [r, g, b]) {
  let x = x0;
  for (const ch of asciiUpper(text)) {
    const glyph = GLYPHS[ch] ?? GLYPHS["-"];
    for (let col = 0; col < 5; col++) {
      for (let row = 0; row < 7; row++) {
        if (!(glyph[col] & (1 << row))) continue;
        fillRect(cv, x + col * scale, y0 + row * scale, scale, scale, [r, g, b]);
      }
    }
    x += 6 * scale;
  }
  return x;
}

const INK = [232, 234, 236];
const DIM = [150, 154, 158];
const PAPER = [22, 24, 26];
const BAND = { ruhsat: [58, 92, 140], sigorta: [42, 122, 96], kasko: [120, 92, 40], muayene: [96, 72, 132] };

/**
 * A 720×460 placeholder. It states what it is, on its face, in the image — so a
 * screenshot of the document wallet can never be mistaken for a real scan.
 */
async function writePlaceholder(sharp, outPath, { title, lines }) {
  const cv = makeCanvas(720, 460, PAPER);
  fillRect(cv, 0, 0, 720, 64, BAND[title.type] ?? BAND.ruhsat);
  drawText(cv, title.text, 24, 24, 3, [255, 255, 255]);
  fillRect(cv, 24, 92, 672, 2, [58, 62, 66]);
  let y = 120;
  for (const [label, value] of lines) {
    drawText(cv, label, 24, y, 2, DIM);
    drawText(cv, value, 250, y, 3, INK);
    y += 46;
  }
  fillRect(cv, 0, 392, 720, 68, [92, 26, 26]);
  drawText(cv, "DEMO DATA - PLACEHOLDER", 24, 404, 3, [255, 230, 230]);
  drawText(cv, "NOT A REAL SCAN - GENERATED BY SEED-DEMO-FLEET", 24, 434, 2, [255, 210, 210]);
  const buf = await sharp(cv.buf, { raw: { width: cv.w, height: cv.h, channels: 3 } })
    .jpeg({ quality: 82 })
    .toBuffer();
  fs.writeFileSync(outPath, buf);
  return buf.length;
}

// ─── auth ────────────────────────────────────────────────────────────────────

/**
 * Create the demo accounts through better-auth's own sign-up API, not with an
 * INSERT. The password then goes through exactly the hashing the real sign-up
 * path uses, which is the only way to be sure a reviewer can actually log in.
 */
async function makeAuth(db) {
  const req = apiRequire();
  const { betterAuth } = await import(pathToFileURL(req.resolve("better-auth")).href);
  return betterAuth({
    database: db,
    baseURL: process.env.APP_BASE_URL ?? "http://localhost:8787",
    // Only used to sign cookies/tokens, which this script never issues; the
    // password hash is per-user scrypt and does not involve it.
    secret: process.env.SESSION_SECRET ?? "seed-demo-fleet-local-secret-not-used-for-sessions",
    emailAndPassword: { enabled: true, autoSignIn: false },
  });
}

// ─── reset ───────────────────────────────────────────────────────────────────

function demoUserIds(db) {
  return db
    .prepare("SELECT id, email FROM user WHERE lower(email) LIKE ?")
    .all(`%@${EMAIL_DOMAIN}`)
    .map((r) => r.id);
}

/**
 * Remove everything this script has ever written, and nothing else. The org
 * cascades take the fleets; the users take their own rows; together they leave
 * the database exactly as it was before the first seed.
 */
function wipe(db, uploadsDir) {
  const removed = { orgs: [], users: 0 };
  for (const org of ORGS) {
    if (db.prepare("SELECT 1 FROM organization WHERE id = ?").get(org.id)) {
      removed.orgs.push({ id: org.id, ...deleteOrganization(db, org.id, { uploadsDir }) });
    }
  }
  const ids = demoUserIds(db);
  const del = db.prepare("DELETE FROM user WHERE id = ?");
  db.transaction(() => {
    for (const id of ids) del.run(id);
  })();
  removed.users = ids.length;
  // Personal uploads for the demo accounts (there should be none, but a demo
  // account used to upload something during a sales call would leave files
  // behind under its own user id).
  for (const id of ids) {
    const dir = path.join(uploadsDir, id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  return removed;
}

// ─── seeding one fleet ───────────────────────────────────────────────────────

/**
 * Vehicles, compliance, service history and fuel for one organization. Both
 * modes get identical treatment here, which is the schema's whole claim: a mode
 * changes only which relationship a vehicle carries, never its records.
 */
function seedFleet(db, org, spec, ctx) {
  const { rand, custodian, office } = ctx;
  const bikes = {};
  const counts = { vehicles: 0, dated: 0, service: 0, serviceCost: 0, fuel: 0, fuelCost: 0 };

  const insBike = db.prepare(
    `INSERT INTO bike (id, user_id, org_id, vehicle_type, nickname, plate, make, model, year,
                       current_km, color, cylinder_cc, fuel_type, first_registration_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  spec.vehicles.forEach((v, i) => {
    const id = `${spec.idPrefix}-bike-${String(i + 1).padStart(2, "0")}`;
    insBike.run(
      id, custodian, org.id, v.t, `${v.mk} ${v.md}`, v.plate, v.mk, v.md, v.yr,
      kmAt(v, 0), v.color, v.cc ?? null, v.fuel,
      `${v.yr}-${String(2 + (i % 9)).padStart(2, "0")}-${String(3 + (i % 24)).padStart(2, "0")}`,
    );
    bikes[v.k] = { ...v, id, kmNow: kmAt(v, 0) };
    counts.vehicles++;
  });

  // ---- compliance ---------------------------------------------------------
  const insDated = db.prepare(
    `INSERT INTO dated_item (id, bike_id, user_id, type, expires_on, provider, policy_no, cost, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const mtvDate = nextJanuaryMtv();
  const datedIds = {};
  let datedSeq = 0;
  const addDated = (v, type, expiresOn, extra = {}) => {
    const id = `${spec.idPrefix}-dated-${String(++datedSeq).padStart(3, "0")}`;
    // Bought a policy term before it expires — see POLICY_TERM_DAYS.
    const boughtAt = isoStampBefore(expiresOn, POLICY_TERM_DAYS[type]);
    insDated.run(
      id, v.id, office, type, expiresOn,
      extra.provider ?? null, extra.policy ?? null, extra.cost ?? null, extra.notes ?? null,
      boughtAt, boughtAt,
    );
    datedIds[`${v.k}:${type}`] = id;
    counts.dated++;
    return id;
  };

  spec.vehicles.forEach((sv, i) => {
    const v = bikes[sv.k];
    const story = spec.story[sv.k] ?? {};
    const provider = SIGORTA_PROVIDERS[i % SIGORTA_PROVIDERS.length];
    const kaskoProvider = SIGORTA_PROVIDERS[(i + 3) % SIGORTA_PROVIDERS.length];
    const healthy = (base) => isoDay(base + Math.floor(rand() * 120)); // 2–11 months out

    addDated(v, "sigorta", story.sigorta !== undefined ? isoDay(story.sigorta) : healthy(70), {
      provider,
      policy: `TRF-${2026 - (i % 2)}-${String(480_000 + i * 137).slice(0, 6)}`,
      cost: round2(4800 + rand() * 4600),
      notes: "Zorunlu trafik sigortası",
    });
    addDated(v, "muayene", story.muayene !== undefined ? isoDay(story.muayene) : healthy(95), {
      provider: "TÜVTÜRK",
      policy: `MUY-${String(70_000 + i * 913)}`,
      cost: 1885,
      notes: sv.t === "motorcycle" ? "Motosiklet periyodik muayene" : "Ticari araç yıllık muayenesi",
    });
    // MTV is a per-instalment figure (two a year), not the annual total.
    addDated(v, "mtv", story.mtv !== undefined ? isoDay(story.mtv) : mtvDate, {
      provider: "Gelir İdaresi Başkanlığı",
      cost: sv.t === "motorcycle" ? round2(550 + rand() * 450) : round2(2400 + rand() * 5600),
      notes: story.mtv !== undefined ? "2. taksit — ödenmedi" : "1. taksit",
    });
    // Kasko is optional and, in practice, carried on the newer half of a fleet.
    if (sv.yr >= 2022 || story.kasko !== undefined) {
      addDated(v, "kasko", story.kasko !== undefined ? isoDay(story.kasko) : healthy(60), {
        provider: kaskoProvider,
        policy: `KSK-2026-${String(310_000 + i * 271).slice(0, 6)}`,
        cost: round2(12_000 + rand() * 14_000),
        notes: "Genişletilmiş kasko",
      });
    }
  });

  // ---- service history ----------------------------------------------------
  const hasCost = db
    .prepare("SELECT 1 FROM pragma_table_info('maintenance_item') WHERE name = 'cost'")
    .get();
  const insMaint = db.prepare(
    hasCost
      ? `INSERT INTO maintenance_item (id, bike_id, user_id, kind, custom_label, last_done_on, last_done_km, interval_months, interval_km, notes, cost)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      : `INSERT INTO maintenance_item (id, bike_id, user_id, kind, custom_label, last_done_on, last_done_km, interval_months, interval_km, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const INTERVAL = {
    engine_oil: [12, 15_000], brakes: [24, 40_000], tires: [36, 50_000],
    battery: [48, 80_000], air_filter: [12, 20_000], custom: [null, null],
  };
  let maintSeq = 0;
  for (const [vk, jobs] of Object.entries(spec.service)) {
    const v = bikes[vk];
    for (const [kind, daysAgo, cost, label] of jobs) {
      const [months, km] = INTERVAL[kind];
      const id = `${spec.idPrefix}-maint-${String(++maintSeq).padStart(3, "0")}`;
      const args = [
        id, v.id, office, kind, label ?? null, isoDay(-daysAgo), kmAt(v, daysAgo),
        months, km, label ? null : "Yetkili serviste yapıldı",
      ];
      if (hasCost) args.push(cost);
      insMaint.run(...args);
      counts.service++;
      counts.serviceCost += cost;
    }
  }

  // ---- fuel ---------------------------------------------------------------
  const insFuel = db.prepare(
    `INSERT INTO fuel_log (id, user_id, bike_id, filled_on, liters, total_cost, odometer_km, is_full, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  );
  let fuelSeq = 0;
  for (const sv of spec.vehicles) {
    const v = bikes[sv.k];
    // A tank is worth ~80% of its nominal capacity before anyone refuels.
    const kmPerTank = (sv.tank * 0.8 * 100) / sv.l100;
    const daysPerFill = Math.max(3, Math.round(kmPerTank / sv.kpd));
    const loggedBy = spec.fuelLoggedBy?.(sv.k) ?? office;
    // Some vehicles stop being logged partway through — see FUEL_STOPS.
    const stopsAt = spec.fuelStops?.[sv.k] ?? 0;
    for (let d = WINDOW_DAYS; d > stopsAt; d -= daysPerFill) {
      const liters = round2(((kmPerTank * sv.l100) / 100) * (0.9 + rand() * 0.18));
      // Pump prices drift a few percent across the window.
      const price = round2(FUEL_PRICE[sv.fuel] * (0.94 + ((WINDOW_DAYS - d) / WINDOW_DAYS) * 0.1));
      const total = round2(liters * price);
      insFuel.run(
        `${spec.idPrefix}-fuel-${String(++fuelSeq).padStart(4, "0")}`,
        loggedBy, v.id, isoDay(-d), liters, total, kmAt(v, d), null,
      );
      counts.fuel++;
      counts.fuelCost += total;
    }
  }

  return { bikes, datedIds, counts };
}

/** The document wallet for one fleet. Returns how many were written. */
async function seedDocuments(db, sharp, org, spec, bikes, datedIds, uploadsDir, office) {
  if (!sharp) return 0;
  const dir = path.join(uploadsDir, "org", org.id);
  fs.mkdirSync(dir, { recursive: true });
  const insDoc = db.prepare(
    `INSERT INTO document (id, user_id, bike_id, file_path, mime_type, size_bytes, doc_type,
                           ocr_extracted_json, ocr_status, ocr_model, applied_dated_item_id)
     VALUES (?, ?, ?, ?, 'image/jpeg', ?, ?, ?, ?, ?, ?)`,
  );
  const TITLE = {
    ruhsat: "ARAC RUHSATI (TESCIL BELGESI)",
    sigorta: "ZORUNLU TRAFIK SIGORTASI",
    kasko: "KASKO POLICESI",
    muayene: "ARAC MUAYENE RAPORU",
  };
  let n = 0;
  for (const [vk, type, status] of spec.docs) {
    const v = bikes[vk];
    const dated =
      type === "ruhsat"
        ? null
        : db
            .prepare("SELECT id, expires_on, provider, policy_no FROM dated_item WHERE id = ?")
            .get(datedIds[`${vk}:${type}`]);
    const id = `${spec.idPrefix}-doc-${String(++n).padStart(2, "0")}`;
    const file = path.join(dir, `${id}.jpg`);
    const lines =
      type === "ruhsat"
        ? [["PLAKA", v.plate], ["MARKA / MODEL", `${v.mk} ${v.md}`], ["MODEL YILI", String(v.yr)],
           ["RENK", v.color], ["YAKIT", v.fuel]]
        : [["PLAKA", v.plate], ["BELGE", type], ["GECERLILIK", dated.expires_on],
           ["KURUM", dated.provider ?? "-"], ["NO", dated.policy_no ?? "-"]];
    const size = await writePlaceholder(sharp, file, { title: { type, text: TITLE[type] }, lines });
    // The extraction, when present, is exactly the text drawn on the image
    // above — nothing is inferred, and ocr_model says where it came from.
    const extracted =
      status === "done"
        ? JSON.stringify({
            docType: type,
            plate: v.plate,
            vehicleType: v.t,
            make: v.mk,
            model: v.md,
            year: v.yr,
            color: v.color,
            fuelType: v.fuel,
            dates: {
              sigortaExpiresOn: type === "sigorta" ? dated.expires_on : null,
              kaskoExpiresOn: type === "kasko" ? dated.expires_on : null,
              muayeneExpiresOn: type === "muayene" ? dated.expires_on : null,
            },
            confidence: 1,
            source: "seed-demo-fleet placeholder — transcribed from the generated image, not OCR",
          })
        : null;
    insDoc.run(
      id, office, v.id, file, size, type, extracted, status,
      status === "done" ? "demo-seed" : null,
      dated && status === "done" ? dated.id : null,
    );
    if (dated && status === "done") {
      db.prepare("UPDATE dated_item SET source_document_id = ? WHERE id = ?").run(id, dated.id);
    }
  }
  return n;
}

// ─── seed ────────────────────────────────────────────────────────────────────

async function seed(db, { uploadsDir, password }) {
  const req = apiRequire();
  const auth = await makeAuth(db);
  const rand = rng(20260817);

  // ---- people -------------------------------------------------------------
  const users = {};
  for (const p of PEOPLE) {
    const res = await auth.api.signUpEmail({ body: { email: p.email, password, name: p.name } });
    const id = res?.user?.id;
    if (!id) bail(`better-auth did not create ${p.email}.`);
    users[p.key] = { ...p, id };
    // Demo accounts are Turkish-speaking, like the customers they represent.
    db.prepare(
      "INSERT INTO profile (user_id, language, timezone) VALUES (?, 'tr', 'Europe/Istanbul') ON CONFLICT(user_id) DO NOTHING",
    ).run(id);
  }

  // ---- organizations ------------------------------------------------------
  for (const org of ORGS) {
    createOrganization(db, { id: org.id, name: org.name, mode: org.mode, maxVehicles: org.ceiling });
  }
  for (const p of PEOPLE) {
    for (const [orgId, role] of p.memberships) upsertMember(db, orgId, users[p.key].id, role);
  }

  const custodian = users.manager.id; // whoever registered the vehicle
  const office = users.staff.id; // the person who keeps the rental paperwork
  // The courier firm is small enough that the manager keeps its own paperwork —
  // which is also why its member list is owner + manager + three drivers, with
  // no `staff` role. The rental org is where all four roles are on show.
  const dispatch = users.manager.id;

  // ---- the rental fleet ---------------------------------------------------
  const rentalSpec = {
    idPrefix: "demo",
    vehicles: RENTAL_VEHICLES,
    story: RENTAL_STORY,
    service: RENTAL_SERVICE,
    docs: RENTAL_DOCS,
    // Fuel for the service van is logged by the driver holding it; everything
    // else is entered at the desk from the pump receipts.
    fuelLoggedBy: (k) => (k === "doblo" ? users.driver.id : office),
  };
  const rental = seedFleet(db, RENTAL_ORG, rentalSpec, { rand, custodian, office });

  // ---- the courier fleet --------------------------------------------------
  const courierSpec = {
    idPrefix: "demo-kurye",
    vehicles: COURIER_VEHICLES,
    story: COURIER_STORY,
    service: COURIER_SERVICE,
    docs: COURIER_DOCS,
    fuelStops: FUEL_STOPS,
    // A courier logs their own fill-ups on the vehicle they are holding.
    fuelLoggedBy: (k) => {
      const a = COURIER_ASSIGNMENTS.find((x) => x.v === k && x.end === undefined);
      return a ? users[a.by].id : dispatch;
    },
  };
  const courier = seedFleet(db, COURIER_ORG, courierSpec, {
    rand,
    custodian,
    office: dispatch,
  });

  // ---- customers (rental mode) -------------------------------------------
  const insCustomer = db.prepare(
    "INSERT INTO fleet_customer (id, org_id, name, phone, email, notes) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const customers = {};
  CUSTOMERS.forEach((cst, i) => {
    const id = `demo-customer-${String(i + 1).padStart(2, "0")}`;
    insCustomer.run(id, RENTAL_ORG.id, cst.name, cst.phone, cst.email, cst.notes ?? null);
    customers[cst.k] = id;
  });

  // ---- contracts ----------------------------------------------------------
  const insContract = db.prepare(
    `INSERT INTO rental_contract (id, org_id, bike_id, customer_id, started_at, ends_at, returned_at,
                                  handover_km, return_km, daily_rate, currency, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TRY', ?, ?)`,
  );
  let contractSeq = 0;
  let lateReturns = 0;
  for (const cn of CLOSED_CONTRACTS) {
    const v = rental.bikes[cn.v];
    insContract.run(
      `demo-contract-${String(++contractSeq).padStart(2, "0")}`,
      RENTAL_ORG.id, v.id, customers[cn.c],
      isoStamp(-cn.start), isoDay(-(cn.start - cn.days)), isoStamp(-(cn.start - cn.days)),
      kmAt(v, cn.start), kmAt(v, cn.start - cn.days), cn.rate, "returned", cn.notes ?? null,
    );
  }
  for (const cn of OPEN_CONTRACTS) {
    const v = rental.bikes[cn.v];
    const endsIn = cn.days - cn.start; // negative ⇒ the vehicle is late back
    if (endsIn < 0) lateReturns++;
    insContract.run(
      `demo-contract-${String(++contractSeq).padStart(2, "0")}`,
      RENTAL_ORG.id, v.id, customers[cn.c],
      isoStamp(-cn.start), isoDay(endsIn), null,
      kmAt(v, cn.start), null, cn.rate, "open", cn.notes ?? null,
    );
  }

  // ---- who is holding what ------------------------------------------------
  const insAssignment = db.prepare(
    `INSERT INTO vehicle_assignment (id, org_id, bike_id, user_id, started_at, ended_at, start_km, end_km)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Rental mode still has one: a rental company has staff who move cars between
  // branches and take them to service. The Doblo is that van — and it is what
  // makes the restricted driver view demonstrable, because signing in as
  // demo.sofor@ shows this vehicle and nothing else in a 17-vehicle fleet.
  insAssignment.run(
    "demo-assignment-01", RENTAL_ORG.id, rental.bikes.doblo.id, users.driver.id,
    isoStamp(-45), null, kmAt(rental.bikes.doblo, 45), null,
  );
  let assignSeq = 0;
  let openAssignments = 1;
  for (const a of COURIER_ASSIGNMENTS) {
    const v = courier.bikes[a.v];
    const closed = a.end !== undefined;
    if (!closed) openAssignments++;
    insAssignment.run(
      `demo-kurye-assignment-${String(++assignSeq).padStart(2, "0")}`,
      COURIER_ORG.id, v.id, users[a.by].id,
      isoStamp(-a.start), closed ? isoStamp(-a.end) : null,
      kmAt(v, a.start), closed ? kmAt(v, a.end) : null,
    );
  }

  // ---- trips --------------------------------------------------------------
  const insTrip = db.prepare(
    `INSERT INTO trip (id, user_id, bike_id, distance_km, started_at, ended_at, point_count, route, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let tripSeq = 0;
  let tripKm = 0;

  // Whoever was holding a courier vehicle `d` days ago — so a generated trip is
  // always attributed to someone who could have recorded it.
  const holderOn = (vehicleKey, d) => {
    const a = COURIER_ASSIGNMENTS.find(
      (x) => x.v === vehicleKey && x.start >= d && (x.end ?? 0) <= d,
    );
    return a?.by ?? "manager";
  };
  const allTrips = [...TRIPS];
  for (let d = POOL_ROUNDS.fromDay; d >= POOL_ROUNDS.toDay; d -= POOL_ROUNDS.everyDays) {
    allTrips.push({
      org: POOL_ROUNDS.org,
      v: POOL_ROUNDS.v,
      by: holderOn(POOL_ROUNDS.v, d),
      route: POOL_ROUNDS.route,
      d,
      h: POOL_ROUNDS.hour,
    });
  }

  for (const t of allTrips) {
    const fleet = t.org === "rental" ? rental : courier;
    const v = fleet.bikes[t.v];
    const def = ROUTES[t.route];
    const points = traceRoute(def.points, rand);
    const km = round2(traceLengthKm(points));
    const minutes = Math.round((km / def.kmh) * 60);
    const startedAt = isoStamp(-t.d, t.h);
    const endedAt = new Date(new Date(`${startedAt.replace(" ", "T")}Z`).getTime() + minutes * 60_000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    insTrip.run(
      `demo-trip-${String(++tripSeq).padStart(3, "0")}`,
      users[t.by].id, v.id, km, startedAt, endedAt,
      // What the phone actually sampled before the client simplified it: one
      // fix every few seconds, roughly a point every 40 m.
      Math.round((km * 1000) / 40),
      encodePolyline(points),
      endedAt,
    );
    tripKm += km;
  }

  // ---- document wallets ---------------------------------------------------
  let sharp = null;
  try {
    sharp = req("sharp");
  } catch {
    warn("sharp is unavailable — skipping the demo document wallets (everything else is seeded).");
  }
  const rentalDocs = await seedDocuments(
    db, sharp, RENTAL_ORG, rentalSpec, rental.bikes, rental.datedIds, uploadsDir, office,
  );
  const courierDocs = await seedDocuments(
    db, sharp, COURIER_ORG, courierSpec, courier.bikes, courier.datedIds, uploadsDir, dispatch,
  );

  return {
    users,
    rental: rental.counts,
    courier: courier.counts,
    customers: CUSTOMERS.length,
    contracts: contractSeq,
    lateReturns,
    assignments: assignSeq + 1,
    openAssignments,
    trips: tripSeq,
    tripKm: round2(tripKm),
    documents: rentalDocs + courierDocs,
  };
}

// ─── read-back verification ──────────────────────────────────────────────────

/**
 * Query the fleets back the way the screens will, so a run PROVES the story
 * rather than asserting it. Same shape as the triage board (§7.1) and the costs
 * rollup (§7.4) — including `contract_due`, which is how orgFleet.ts puts a
 * late return on the board next to an expired policy.
 */
function verifyOrg(db, org) {
  const dated = db
    .prepare(
      `SELECT b.plate, b.nickname, d.type AS kind, d.expires_on AS due_on,
              CAST(julianday(d.expires_on) - julianday('now') AS INTEGER) AS days
         FROM dated_item d JOIN bike b ON b.id = d.bike_id
        WHERE b.org_id = ? AND b.archived = 0
          AND d.expires_on <= date('now', '+30 days')`,
    )
    .all(org.id);

  const late =
    org.mode === "rental"
      ? db
          .prepare(
            `SELECT b.plate, b.nickname, 'contract_due' AS kind, date(rc.ends_at) AS due_on,
                    CAST(julianday(rc.ends_at) - julianday('now') AS INTEGER) AS days,
                    fc.name AS holder
               FROM rental_contract rc
               JOIN bike b ON b.id = rc.bike_id
               JOIN fleet_customer fc ON fc.id = rc.customer_id
              WHERE rc.org_id = ? AND rc.status = 'open' AND rc.ends_at IS NOT NULL
                AND date(rc.ends_at) <= date('now', '+30 days')`,
          )
          .all(org.id)
      : [];

  const triage = [...dated, ...late].sort((a, b) => a.days - b.days);

  const costs = db
    .prepare(
      `WITH f AS (SELECT bike_id, SUM(total_cost) c, MAX(odometer_km) - MIN(odometer_km) km
                    FROM fuel_log GROUP BY bike_id),
            m AS (SELECT bike_id, SUM(COALESCE(cost, 0)) c FROM maintenance_item GROUP BY bike_id),
            d AS (SELECT bike_id, SUM(COALESCE(cost, 0)) c FROM dated_item GROUP BY bike_id),
            -- Trip distance counts only where the odometer trail has genuinely
            -- run out: journeys more than three weeks past this vehicle's last
            -- recorded fill-up. (Every vehicle has a few trips after its most
            -- recent fill; that is a tail, not a gap.) Mirrors what
            -- /fleet/costs does month by month.
            t AS (SELECT tr.bike_id, SUM(tr.distance_km) km
                    FROM trip tr
                   WHERE substr(tr.started_at, 1, 10) >
                         date(COALESCE((SELECT MAX(fl.filled_on) FROM fuel_log fl
                                         WHERE fl.bike_id = tr.bike_id), '0000-01-01'), '+21 days')
                   GROUP BY tr.bike_id)
       SELECT b.plate, b.nickname,
              ROUND(COALESCE(f.c,0), 0) AS fuel,
              ROUND(COALESCE(m.c,0), 0) AS service,
              ROUND(COALESCE(d.c,0), 0) AS compliance,
              ROUND(COALESCE(f.km,0) + COALESCE(t.km,0), 0) AS km,
              CASE WHEN COALESCE(t.km,0) > 0 THEN 'odometer+gps' ELSE 'odometer' END AS km_source,
              ROUND((COALESCE(f.c,0) + COALESCE(m.c,0) + COALESCE(d.c,0))
                      / NULLIF(COALESCE(f.km,0) + COALESCE(t.km,0), 0), 2) AS per_km
         FROM bike b LEFT JOIN f ON f.bike_id = b.id
                     LEFT JOIN m ON m.bike_id = b.id
                     LEFT JOIN d ON d.bike_id = b.id
                     LEFT JOIN t ON t.bike_id = b.id
        WHERE b.org_id = ? AND b.archived = 0
        ORDER BY per_km DESC`,
    )
    .all(org.id);

  const strip = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM bike WHERE org_id = $o AND archived = 0) AS vehicles,
              (SELECT COUNT(*) FROM rental_contract WHERE org_id = $o AND status = 'open') AS on_rent,
              (SELECT COUNT(*) FROM vehicle_assignment WHERE org_id = $o AND ended_at IS NULL) AS assigned,
              (SELECT COUNT(*) FROM vehicle_assignment WHERE org_id = $o AND ended_at IS NOT NULL) AS past_assignments,
              (SELECT COUNT(*) FROM document WHERE ocr_status = 'pending'
                 AND bike_id IN (SELECT id FROM bike WHERE org_id = $o)) AS pending_ocr,
              (SELECT COUNT(*) FROM fleet_customer WHERE org_id = $o) AS customers,
              (SELECT COUNT(*) FROM trip WHERE bike_id IN (SELECT id FROM bike WHERE org_id = $o)) AS trips`,
    )
    .get({ o: org.id });

  return { org, triage, costs, strip };
}

function reportOrg({ org, triage, costs, strip }) {
  const overdue = triage.filter((r) => r.days < 0);
  const soon = triage.filter((r) => r.days >= 0);
  console.log("");
  say(`${org.name} — triage board (${org.mode})`);
  console.log(`  ${overdue.length} overdue · ${soon.length} due within 30 days`);
  for (const r of triage) {
    const d = r.days < 0 ? `${r.days}` : `+${r.days}`;
    const late = r.kind === "contract_due" && r.days < 0 ? "  ← ARAÇ İADE EDİLMEDİ" : "";
    console.log(
      `   ${d.padStart(5)}d  ${(r.plate ?? "").padEnd(12)} ${String(r.kind).padEnd(13)} ${r.due_on}  ` +
        `${r.nickname.padEnd(24)} ${r.holder ?? ""}${late}`,
    );
  }

  const perKm = costs.filter((c) => c.per_km != null).map((c) => c.per_km).sort((a, b) => a - b);
  const median = perKm[Math.floor(perKm.length / 2)];
  console.log("");
  say(`${org.name} — cost per vehicle (${WINDOW_DAYS} days) — median ₺${median}/km`);
  for (const c of costs.slice(0, 4)) {
    const flag = c.per_km > median * 1.5 ? "  ← outlier" : "";
    const src = c.km_source === "odometer+gps" ? "  (mesafenin bir kısmı GPS'ten)" : "";
    console.log(
      `   ₺${String(c.per_km).padStart(6)}/km  ${(c.plate ?? "").padEnd(12)} ${c.nickname.padEnd(24)} ` +
        `yakıt ₺${c.fuel}  servis ₺${c.service}  vergi/sigorta ₺${c.compliance}  ${c.km} km${flag}${src}`,
    );
  }
  if (costs.length > 4) console.log(`   …${costs.length - 4} more`);
  for (const c of costs.filter((x) => x.km_source === "odometer+gps")) {
    console.log(
      `   ${c.plate}: fuel logging stopped — the months since are measured from GPS trips` +
        " (the /fleet/costs distance fallback).",
    );
  }

  console.log("");
  say(`${org.name} — fleet summary strip`);
  const inUse = org.mode === "rental" ? strip.on_rent : strip.assigned;
  console.log(
    `  vehicles ${strip.vehicles} · in use ${inUse} · idle ${strip.vehicles - strip.on_rent - strip.assigned} · ` +
      (org.mode === "rental"
        ? `on rent ${strip.on_rent} · customers ${strip.customers} · `
        : `assigned ${strip.assigned} · past assignments ${strip.past_assignments} · `) +
      `trips ${strip.trips} · documents pending OCR ${strip.pending_ocr}`,
  );
}

// ─── entry point ─────────────────────────────────────────────────────────────

export async function main(argv = process.argv.slice(2)) {
  const { opts } = parseArgs(argv);
  const dbPath = resolveDbPath(opts);
  const uploadsDir = resolveUploadsDir(opts);
  const password = opts.password ?? DEFAULT_PASSWORD;

  if (!opts.yes) {
    bail(
      "Refusing to run without --yes.\n" +
        `  Target would be: ${dbPath}\n` +
        `  This writes ${ORGS.length} demo organizations and ${PEOPLE.length} demo accounts.`,
    );
  }

  const db = openDb(dbPath);
  try {
    if (opts.migrate) {
      const applied = ensureSchema(db);
      if (applied.length) say(`Applied ${applied.length} migration(s) to ${dbPath}.`);
    }
    assertSchema(db);

    // The guard. Demo data is safe to re-seed; a database that already holds
    // REAL customers is not something to touch on a typo, so it needs a second,
    // deliberate flag. (Seeding production IS supported — App Review logs into
    // production — it just has to be meant.)
    const demoIds = ORGS.map((o) => o.id);
    const foreignOrgs = db
      .prepare(`SELECT COUNT(*) n FROM organization WHERE id NOT IN (${demoIds.map(() => "?").join(", ")})`)
      .get(...demoIds).n;
    const foreignUsers = db
      .prepare("SELECT COUNT(*) n FROM user WHERE lower(email) NOT LIKE ?")
      .get(`%@${EMAIL_DOMAIN}`).n;
    say(`Target: ${dbPath}`);
    console.log(`  existing: ${foreignOrgs} other organization(s), ${foreignUsers} other user(s)`);
    if ((foreignOrgs > 0 || foreignUsers > 0) && !opts.allowNonempty) {
      bail(
        "This database already holds non-demo data. If that is deliberate (production,\n" +
          "  where App Review has to sign in), re-run with --allow-nonempty.",
      );
    }

    const removed = wipe(db, uploadsDir);
    if (removed.orgs.length || removed.users) {
      say(
        `Reset previous demo data: ${removed.orgs.length} organization(s), ` +
          `${removed.orgs.reduce((a, o) => a + o.vehicles, 0)} vehicles, ${removed.users} account(s).`,
      );
    }
    if (opts.wipe) {
      ok("Demo data removed. Nothing was seeded (--wipe).");
      return;
    }

    const s = await seed(db, { uploadsDir, password });

    console.log("");
    ok(`Seeded ${ORGS.length} demo organizations.`);
    console.log(
      `  ${RENTAL_ORG.name} (rental, ceiling ${RENTAL_ORG.ceiling})\n` +
        `    ${s.rental.vehicles} vehicles · ${s.rental.dated} compliance items · ` +
        `${s.rental.service} service records (₺${Math.round(s.rental.serviceCost).toLocaleString("tr-TR")}) · ` +
        `${s.rental.fuel} fuel logs (₺${Math.round(s.rental.fuelCost).toLocaleString("tr-TR")})\n` +
        `    ${s.customers} customers · ${s.contracts} contracts (${s.lateReturns} late back)`,
    );
    console.log(
      `  ${COURIER_ORG.name} (fleet, ceiling ${COURIER_ORG.ceiling})\n` +
        `    ${s.courier.vehicles} vehicles · ${s.courier.dated} compliance items · ` +
        `${s.courier.service} service records (₺${Math.round(s.courier.serviceCost).toLocaleString("tr-TR")}) · ` +
        `${s.courier.fuel} fuel logs (₺${Math.round(s.courier.fuelCost).toLocaleString("tr-TR")})\n` +
        `    ${s.openAssignments} open assignments, ${s.assignments - s.openAssignments} in history`,
    );
    console.log(`  ${s.trips} GPS trips (${s.tripKm.toLocaleString("tr-TR")} km) · ${s.documents} documents`);

    if (!opts.noVerify) {
      for (const org of ORGS) reportOrg(verifyOrg(db, org));
    }

    console.log("");
    say("Demo sign-in credentials");
    for (const p of PEOPLE) {
      const roles = p.memberships
        .map(([id, role]) => `${role}@${id === RENTAL_ORG.id ? "kiralama" : "kurye"}`)
        .join(", ");
      const mark = HEADLINE_ACCOUNTS.includes(p.key) ? "→" : " ";
      console.log(`  ${mark} ${p.email.padEnd(32)} ${password.padEnd(18)} ${p.name.padEnd(16)} ${roles}`);
    }
    console.log("");
    console.log("  → App Review (Guideline 2.1(a)) gets demo@ — owner of BOTH organizations, so");
    console.log("    one sign-in shows the rental company and the courier fleet.");
    console.log("  → demo.sofor@ demonstrates the restricted driver view: one vehicle (07 JR 806),");
    console.log("    no fleet navigation, in a 17-vehicle company.");
    warn("Rotate the password with --password before pasting it into App Store Connect.");

    const priceAge = daysSince(FUEL_PRICES_SET_ON);
    if (priceAge > FUEL_PRICE_STALE_DAYS) {
      warn(
        `Fuel prices were set ${priceAge} days ago (${FUEL_PRICES_SET_ON}). Update FUEL_PRICE and\n` +
          "  FUEL_PRICES_SET_ON in scripts/seed-demo-fleet.mjs — stale ₺/L is the one thing a\n" +
          "  Turkish prospect will spot instantly.",
      );
    }
  } finally {
    db.close();
  }
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  main().catch((err) => {
    if (err instanceof OperatorError) console.error(`✗ ${err.message}`);
    else console.error(`✗ ${err?.stack ?? err}`);
    process.exitCode = 1;
  });
}
