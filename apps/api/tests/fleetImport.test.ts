import { describe, it, expect } from "vitest";
import request from "supertest";
import { fleetFixture, isoInDays, type FleetFixture } from "./helpers/fleetFixture.js";
import { getDb } from "../src/db/index.js";

/**
 * CSV bulk import. Two properties matter more than any convenience:
 *
 *   1. PREVIEW WRITES NOTHING.
 *   2. COMMIT IS ALL OR NOTHING — a file with one bad row leaves the database
 *      exactly as it was, so re-running after a fix cannot produce duplicates.
 *
 * Everything else here is about accepting the file the customer already has:
 * Turkish headers, a `;` from Turkish Excel, a BOM, `dd.mm.yyyy`, and plates
 * with whatever spacing the person typing them felt like.
 */

const previewUrl = (orgId: string) => `/api/orgs/${orgId}/import/vehicles/preview`;
const commitUrl = (orgId: string) => `/api/orgs/${orgId}/import/vehicles/commit`;

/** The real thing: BOM, semicolons, Turkish headers, dd.mm.yyyy, loose plates. */
const TURKISH_CSV =
  "﻿Plaka;Marka;Model;Model Yılı;Kilometre;Araç Tipi;Şasi No;Sigorta Bitiş;Muayene Bitiş\r\n" +
  "41 DEF 321;Ford;Transit;2021;125.000;Kamyonet;NM0KXXTTFK123456;03.04.2027;15.08.2027\r\n" +
  "06-xyz-99;Fiat;Doblo;2019;88 500;Otomobil;;01.12.2026;\r\n" +
  "35KLM1;Honda;PCX;2022;9.100;Motosiklet;;;\r\n";

function bikeCount(orgId: string): number {
  return (getDb().prepare("SELECT COUNT(*) c FROM bike WHERE org_id = ?").get(orgId) as { c: number }).c;
}

function post(f: FleetFixture, url: string, cookie: string, csv: string) {
  return request(f.app).post(url).set("Cookie", cookie).send({ csv });
}

describe("preview", () => {
  it("reads the messy real thing: BOM, semicolons, Turkish headers, dd.mm.yyyy", async () => {
    const f = await fleetFixture("fleet");
    const res = await post(f, previewUrl(f.orgId), f.owner.cookie, TURKISH_CSV);
    expect(res.status).toBe(200);
    expect(res.body.delimiter).toBe(";");
    expect(res.body.totalRows).toBe(3);
    expect(res.body.errorRows).toBe(0);
    expect(res.body.columns.map((c: { field: string | null }) => c.field)).toEqual([
      "plate",
      "make",
      "model",
      "year",
      "currentKm",
      "vehicleType",
      "chassisNo",
      "sigorta",
      "muayene",
    ]);
    expect(res.body.rows[0].values).toMatchObject({
      plate: "41DEF321",
      make: "Ford",
      year: 2021,
      currentKm: 125000,
      vehicleType: "car",
      sigorta: "2027-04-03",
      muayene: "2027-08-15",
    });
    expect(res.body.rows[2].values.vehicleType).toBe("motorcycle");
    // Preview writes nothing at all.
    expect(bikeCount(f.orgId)).toBe(2);
  });

  it("accepts a comma-delimited English file just as happily", async () => {
    const f = await fleetFixture("fleet");
    const csv = "plate,make,model,km\n07 AAA 11,Renault,Kangoo,42000\n";
    const res = await post(f, previewUrl(f.orgId), f.owner.cookie, csv);
    expect(res.body.delimiter).toBe(",");
    expect(res.body.validRows).toBe(1);
    expect(res.body.rows[0].values.currentKm).toBe(42000);
  });

  it("reports per-row errors with the file line the user can see", async () => {
    const f = await fleetFixture("fleet");
    const csv =
      "Plaka;Model Yılı;Kilometre;Sigorta Bitiş\n" +
      "07 AAA 11;2021;10000;03.04.2027\n" +
      "07 BBB 22;1750;10000;03.04.2027\n" +
      "07 CCC 33;2021;çok;03.04.2027\n" +
      "07 DDD 44;2021;10000;31.02.2027\n" +
      "X;2021;10000;03.04.2027\n";
    const res = await post(f, previewUrl(f.orgId), f.owner.cookie, csv);
    expect(res.status).toBe(200);
    expect(res.body.validRows).toBe(1);
    expect(res.body.errorRows).toBe(4);
    const codes = res.body.rows.map((r: { errors: { code: string }[] }) => r.errors.map((e) => e.code));
    expect(codes).toEqual([[], ["invalid_year"], ["invalid_km"], ["invalid_date"], ["invalid_plate"]]);
    expect(res.body.rows[1].line).toBe(3);
    expect(res.body.rows[1].row).toBe(2);
  });

  it("catches a plate that repeats in the file and one already in the fleet", async () => {
    const f = await fleetFixture("fleet");
    const csv = "Plaka;Marka\n34abc123;Ford\n99 ZZZ 11;Fiat\n99ZZZ11;Opel\n";
    const res = await post(f, previewUrl(f.orgId), f.owner.cookie, csv);
    const codes = res.body.rows.map((r: { errors: { code: string }[] }) => r.errors.map((e) => e.code));
    // Row 1 is the fixture's own 34 ABC 123, however it was spaced.
    expect(codes[0]).toEqual(["plate_exists"]);
    expect(codes[1]).toEqual([]);
    expect(codes[2]).toEqual(["duplicate_plate_in_file"]);
  });

  it("says so when nothing in the header is recognisable", async () => {
    const f = await fleetFixture("fleet");
    const res = await post(f, previewUrl(f.orgId), f.owner.cookie, "kedi;köpek\n1;2\n");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("no_recognised_columns");
  });

  it("warns before committing would breach the org's ceiling", async () => {
    const f = await fleetFixture("fleet");
    getDb().prepare("UPDATE organization SET max_vehicles = 3 WHERE id = ?").run(f.orgId);
    const res = await post(f, previewUrl(f.orgId), f.owner.cookie, TURKISH_CSV);
    expect(res.body).toMatchObject({
      maxVehicles: 3,
      currentVehicles: 2,
      validRows: 3,
      wouldExceedLimit: true,
    });
  });

  it("is closed to staff and drivers, and to other tenants", async () => {
    const f = await fleetFixture("fleet");
    for (const c of [f.staff, f.driver]) {
      expect((await post(f, previewUrl(f.orgId), c.cookie, TURKISH_CSV)).status).toBe(403);
    }
    for (const c of [f.rival, f.outsider]) {
      expect((await post(f, previewUrl(f.orgId), c.cookie, TURKISH_CSV)).status).toBe(404);
    }
    expect(bikeCount(f.orgId)).toBe(2);
  });
});

describe("commit", () => {
  it("creates every vehicle and its renewal dates in one go", async () => {
    const f = await fleetFixture("fleet");
    const res = await post(f, commitUrl(f.orgId), f.manager.cookie, TURKISH_CSV);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ created: 3, datedItemsCreated: 3 });
    expect(bikeCount(f.orgId)).toBe(5);

    const inventory = await request(f.app)
      .get(`/api/orgs/${f.orgId}/vehicles?q=06XYZ99`)
      .set("Cookie", f.owner.cookie);
    expect(inventory.body.items[0]).toMatchObject({
      plate: "06XYZ99",
      make: "Fiat",
      model: "Doblo",
      year: 2019,
      currentKm: 88500,
      vehicleType: "car",
    });
    // The compliance dates landed, which is what turns the triage board on.
    const board = await request(f.app)
      .get(`/api/orgs/${f.orgId}/triage?horizonDays=365`)
      .set("Cookie", f.owner.cookie);
    expect(board.body.upcoming.length + board.body.overdue.length).toBe(3);
  });

  it("nicknames a vehicle from its plate when the sheet has no name column", async () => {
    const f = await fleetFixture("fleet");
    await post(f, commitUrl(f.orgId), f.owner.cookie, "Plaka;Marka\n07 AAA 11;Renault\n");
    const row = getDb()
      .prepare("SELECT nickname FROM bike WHERE plate = ?")
      .get("07AAA11") as { nickname: string };
    expect(row.nickname).toBe("07AAA11");
  });

  it("WRITES NOTHING when a single row is invalid", async () => {
    const f = await fleetFixture("fleet");
    const csv = "Plaka;Marka;Model Yılı\n07 AAA 11;Ford;2021\n07 BBB 22;Fiat;1750\n07 CCC 33;Opel;2020\n";
    const res = await post(f, commitUrl(f.orgId), f.owner.cookie, csv);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("import_invalid");
    expect(res.body.preview.errorRows).toBe(1);
    expect(bikeCount(f.orgId)).toBe(2);

    // Fixing the one row and re-running produces no duplicates of the good ones.
    const fixed = csv.replace("1750", "2018");
    const ok = await post(f, commitUrl(f.orgId), f.owner.cookie, fixed);
    expect(ok.status).toBe(201);
    expect(ok.body.created).toBe(3);
    expect(bikeCount(f.orgId)).toBe(5);
  });

  it("refuses the whole file rather than filling the org up to its ceiling", async () => {
    const f = await fleetFixture("fleet");
    getDb().prepare("UPDATE organization SET max_vehicles = 4 WHERE id = ?").run(f.orgId);
    const res = await post(f, commitUrl(f.orgId), f.owner.cookie, TURKISH_CSV);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("vehicle_limit_reached");
    expect(bikeCount(f.orgId)).toBe(2);

    // Exactly at the ceiling is allowed.
    getDb().prepare("UPDATE organization SET max_vehicles = 5 WHERE id = ?").run(f.orgId);
    expect((await post(f, commitUrl(f.orgId), f.owner.cookie, TURKISH_CSV)).status).toBe(201);
    expect(bikeCount(f.orgId)).toBe(5);
  });

  it("counts archived vehicles as free slots, exactly like POST /api/bikes", async () => {
    const f = await fleetFixture("fleet");
    getDb().prepare("UPDATE organization SET max_vehicles = 4 WHERE id = ?").run(f.orgId);
    await request(f.app).delete(`/api/bikes/${f.truck}`).set("Cookie", f.owner.cookie);
    const res = await post(f, commitUrl(f.orgId), f.owner.cookie, TURKISH_CSV);
    expect(res.status).toBe(201);
  });

  it("rejects an empty file and a header-only file", async () => {
    const f = await fleetFixture("fleet");
    expect((await post(f, commitUrl(f.orgId), f.owner.cookie, "")).status).toBe(400);
    const headerOnly = await post(f, commitUrl(f.orgId), f.owner.cookie, "Plaka;Marka\n");
    expect(headerOnly.status).toBe(400);
    expect(headerOnly.body.error).toBe("import_empty");
    expect(bikeCount(f.orgId)).toBe(2);
  });

  it("is closed to staff and drivers, and cannot be aimed at another tenant", async () => {
    const f = await fleetFixture("fleet");
    for (const c of [f.staff, f.driver]) {
      expect((await post(f, commitUrl(f.orgId), c.cookie, TURKISH_CSV)).status).toBe(403);
    }
    expect((await post(f, commitUrl(f.orgId), f.rival.cookie, TURKISH_CSV)).status).toBe(404);
    expect((await post(f, commitUrl(f.rivalOrgId), f.owner.cookie, TURKISH_CSV)).status).toBe(404);
    expect(bikeCount(f.orgId)).toBe(2);
    expect(bikeCount(f.rivalOrgId)).toBe(1);
  });

  it("lands the vehicles in the importing org only, custodied by the importer", async () => {
    const f = await fleetFixture("fleet");
    await post(f, commitUrl(f.orgId), f.manager.cookie, "Plaka;Marka\n07 AAA 11;Renault\n");
    const row = getDb()
      .prepare("SELECT org_id, user_id FROM bike WHERE plate = ?")
      .get("07AAA11") as { org_id: string; user_id: string };
    expect(row.org_id).toBe(f.orgId);
    expect(row.user_id).toBe(f.manager.user.id);
    // Custody is not access: the rival still cannot see it, and it is not in
    // the manager's personal garage either.
    const rivalList = await request(f.app)
      .get(`/api/orgs/${f.rivalOrgId}/vehicles`)
      .set("Cookie", f.rival.cookie);
    expect(rivalList.body.total).toBe(1);
    const ent = await request(f.app).get("/api/entitlement").set("Cookie", f.manager.cookie);
    expect(ent.body.activeVehicles).toBe(0);
  });

  it("imports an already-expired renewal date, so day one shows the truth", async () => {
    const f = await fleetFixture("fleet");
    const past = isoInDays(-20).split("-").reverse().join(".");
    await post(f, commitUrl(f.orgId), f.owner.cookie, `Plaka;Sigorta Bitiş\n07 AAA 11;${past}\n`);
    const board = await request(f.app).get(`/api/orgs/${f.orgId}/triage`).set("Cookie", f.owner.cookie);
    expect(board.body.overdue).toHaveLength(1);
    expect(board.body.overdue[0]).toMatchObject({ kind: "sigorta", daysRemaining: -20 });
  });

  it("rejects a body that is not a CSV string", async () => {
    const f = await fleetFixture("fleet");
    for (const body of [{}, { csv: 42 }, { csv: "a;b\n1;2", delimiter: "%" }]) {
      const res = await request(f.app)
        .post(commitUrl(f.orgId))
        .set("Cookie", f.owner.cookie)
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});
