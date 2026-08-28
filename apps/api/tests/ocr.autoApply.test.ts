import { describe, it, expect, beforeEach } from "vitest";
import { resetDbForTests, getDb } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { autoApply } from "../src/ocr/autoApply.js";
import type { ParsedOcr } from "../src/ocr/parser.js";
import { addMember, assignVehicle, createOrg, endAssignment } from "./helpers/org.js";

/**
 * autoApply decides which vehicle a finished scan lands on. Before the org
 * layer that decision was "a bike whose user_id is the uploader", which on a
 * fleet is wrong in both directions: it refuses the vehicle the uploader is
 * legitimately working on (custodian is somebody else), and it then falls
 * through to the uploader's PERSONAL garage — up to and including creating a
 * personal vehicle out of a company ruhsat. These tests pin the boundary.
 */

function parsed(over: Partial<ParsedOcr> = {}): ParsedOcr {
  return {
    docType: "ruhsat",
    plate: null,
    make: null,
    model: null,
    year: null,
    firstRegistrationDate: null,
    color: null,
    chassisNo: null,
    engineNo: null,
    cylinderCc: null,
    fuelType: null,
    dates: { sigortaExpiresOn: null, kaskoExpiresOn: null, muayeneExpiresOn: null },
    fuel: null,
    confidence: 0.95,
    ...over,
  };
}

function seedUser(id: string): void {
  getDb().prepare("INSERT INTO user (id, email) VALUES (?, ?)").run(id, `${id}@t.io`);
}

function seedBike(
  id: string,
  userId: string,
  opts: { plate?: string | null; orgId?: string | null; make?: string | null } = {},
): void {
  getDb()
    .prepare(
      "INSERT INTO bike (id, user_id, nickname, plate, make, org_id) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(id, userId, "B", opts.plate ?? null, opts.make ?? null, opts.orgId ?? null);
}

function seedDocument(id: string, userId: string, bikeId: string | null): void {
  getDb()
    .prepare(
      `INSERT INTO document (id, user_id, bike_id, file_path, mime_type, size_bytes, ocr_status)
       VALUES (?, ?, ?, '/tmp/x.jpg', 'image/jpeg', 1, 'done')`,
    )
    .run(id, userId, bikeId);
}

function bikesOf(userId: string): { id: string; org_id: string | null }[] {
  return getDb()
    .prepare("SELECT id, org_id FROM bike WHERE user_id = ?")
    .all(userId) as { id: string; org_id: string | null }[];
}

function run(userId: string, bikeIdHint: string | null, p: ParsedOcr) {
  return autoApply({
    db: getDb(),
    userId,
    documentId: "doc1",
    bikeIdHint,
    parsed: p,
    threshold: 0.6,
  });
}

describe("autoApply — personal vehicles (unchanged behaviour)", () => {
  beforeEach(() => {
    resetDbForTests(":memory:");
    runMigrations();
    seedUser("u1");
  });

  it("honours the hint on the uploader's own vehicle", () => {
    seedBike("b1", "u1");
    seedDocument("doc1", "u1", "b1");
    const out = run("u1", "b1", parsed({ make: "Honda", model: "PCX" }));
    expect(out.appliedBikeId).toBe("b1");
    expect(out.bikeAction).toBe("updated");
  });

  it("matches a personal vehicle by plate when there is no hint", () => {
    seedBike("b1", "u1", { plate: "34 ABC 123" });
    seedDocument("doc1", "u1", null);
    const out = run("u1", null, parsed({ plate: "34ABC123" }));
    expect(out.appliedBikeId).toBe("b1");
    expect(out.bikeAction).toBe("matched");
  });

  it("creates a personal vehicle from a ruhsat when nothing matches", () => {
    seedDocument("doc1", "u1", null);
    const out = run("u1", null, parsed({ plate: "34XYZ9", make: "Honda" }));
    expect(out.bikeAction).toBe("created");
    const rows = bikesOf("u1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.org_id).toBeNull();
  });

  it("applies a dated item to the hinted personal vehicle", () => {
    seedBike("b1", "u1");
    seedDocument("doc1", "u1", "b1");
    const out = run(
      "u1",
      "b1",
      parsed({
        docType: "sigorta",
        dates: { sigortaExpiresOn: "2027-01-01", kaskoExpiresOn: null, muayeneExpiresOn: null },
      }),
    );
    expect(out.appliedDatedItemId).not.toBeNull();
    expect(out.appliedBikeId).toBe("b1");
  });

  it("does not touch another user's vehicle via the hint", () => {
    seedUser("u2");
    seedBike("b2", "u2");
    seedDocument("doc1", "u1", null);
    const out = run("u1", "b2", parsed({ plate: "34ZZZ1", make: "Honda" }));
    // A hint we may not write is a dead end — we never fall through to a guess,
    // because the uploader already told us which vehicle this document is about.
    expect(out.appliedBikeId).toBeNull();
    expect(bikesOf("u1")).toHaveLength(0);
    expect(bikesOf("u2")).toHaveLength(1);
  });
});

describe("autoApply — organization vehicles", () => {
  let orgId: string;

  beforeEach(() => {
    resetDbForTests(":memory:");
    runMigrations();
    seedUser("owner");
    seedUser("staff");
    seedUser("driver");
    seedUser("outsider");
    orgId = createOrg("Kervan Filo", "fleet");
    addMember(orgId, "owner", "owner");
    addMember(orgId, "staff", "staff");
    addMember(orgId, "driver", "driver");
    // The company van: custodian is the OWNER, not the person scanning.
    seedBike("van", "owner", { plate: "34 VAN 01", orgId });
  });

  it("LEAK: a company ruhsat scanned by staff never lands in a private garage", () => {
    // Staff has a personal vehicle with the SAME plate discipline the old code
    // fell through to, plus the plate on the company papers.
    seedDocument("doc1", "staff", "van");
    const out = run("staff", "van", parsed({ plate: "34 VAN 01", make: "Ford", model: "Transit" }));

    // The scan must land on the org vehicle it was attached to…
    expect(out.appliedBikeId).toBe("van");
    expect(["matched", "updated"]).toContain(out.bikeAction);
    // …and must NOT have minted a personal vehicle for the member.
    expect(bikesOf("staff")).toHaveLength(0);
    const all = getDb().prepare("SELECT COUNT(*) AS c FROM bike").get() as { c: number };
    expect(all.c).toBe(1);
  });

  it("LEAK: a plate that matches an org vehicle never creates a personal copy for a hintless scan", () => {
    seedDocument("doc1", "staff", null);
    const out = run("staff", null, parsed({ plate: "34 VAN 01", make: "Ford" }));
    // With no vehicle context we refuse to guess into the fleet, and we must
    // not create a personal vehicle out of the company's plate either.
    expect(out.appliedBikeId).toBeNull();
    expect(bikesOf("staff")).toHaveLength(0);
  });

  it("fills blanks on an org vehicle even though the uploader is not its custodian", () => {
    seedDocument("doc1", "staff", "van");
    const out = run("staff", "van", parsed({ make: "Ford", model: "Transit", year: 2021 }));
    expect(out.bikeAction).toBe("updated");
    const row = getDb().prepare("SELECT make, model, year FROM bike WHERE id = 'van'").get() as {
      make: string | null;
      model: string | null;
      year: number | null;
    };
    expect(row.make).toBe("Ford");
    expect(row.model).toBe("Transit");
    expect(row.year).toBe(2021);
  });

  it("an assigned driver may apply a dated item to the vehicle they hold", () => {
    const a = assignVehicle(orgId, "van", "driver");
    seedDocument("doc1", "driver", "van");
    const out = run(
      "driver",
      "van",
      parsed({
        docType: "muayene",
        dates: { sigortaExpiresOn: null, kaskoExpiresOn: null, muayeneExpiresOn: "2027-03-01" },
      }),
    );
    expect(out.appliedBikeId).toBe("van");
    expect(out.appliedDatedItemId).not.toBeNull();
    endAssignment(a);
  });

  it("a driver who is not holding the vehicle gets nothing, and no personal copy", () => {
    seedDocument("doc1", "driver", "van");
    const out = run("driver", "van", parsed({ plate: "34 VAN 01", make: "Ford" }));
    expect(out.appliedBikeId).toBeNull();
    expect(bikesOf("driver")).toHaveLength(0);
  });

  it("a non-member gets nothing from an org hint, and no personal copy", () => {
    seedDocument("doc1", "outsider", null);
    const out = run("outsider", "van", parsed({ plate: "34 VAN 01", make: "Ford" }));
    expect(out.appliedBikeId).toBeNull();
    expect(bikesOf("outsider")).toHaveLength(0);
  });

  it("does not fall back to a lone ORG vehicle when the scan has no plate", () => {
    seedDocument("doc1", "staff", null);
    const out = run("staff", null, parsed({ docType: "sigorta", dates: { sigortaExpiresOn: "2027-01-01", kaskoExpiresOn: null, muayeneExpiresOn: null } }));
    expect(out.appliedBikeId).toBeNull();
    expect(out.reason).toBe("no_bike_match");
  });

  it("a fuel receipt scanned against the held vehicle books to the org vehicle", () => {
    const a = assignVehicle(orgId, "van", "driver");
    seedDocument("doc1", "driver", "van");
    const out = run(
      "driver",
      "van",
      parsed({
        docType: "yakit",
        fuel: { filledOn: "2026-08-01", liters: 30, totalCost: 1500, unitPrice: null },
      }),
    );
    expect(out.appliedFuelLogId).not.toBeNull();
    const row = getDb()
      .prepare("SELECT bike_id, user_id FROM fuel_log WHERE id = ?")
      .get(out.appliedFuelLogId) as { bike_id: string; user_id: string };
    expect(row.bike_id).toBe("van");
    expect(row.user_id).toBe("driver");
    endAssignment(a);
  });
});
