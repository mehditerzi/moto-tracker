import { describe, it, expect, beforeEach } from "vitest";
import { resetDbForTests, getDb } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { autoApply, applicableDatedItems } from "../src/ocr/autoApply.js";
import type { ParsedOcr } from "../src/ocr/parser.js";

/**
 * Auto-apply: turning a scanned document into a renewal reminder.
 *
 * This is the feature the app is for, and across 25 production documents it
 * fired zero times. Not "rarely" — never. The cause was one line of reasoning
 * that reads as obviously correct and is not:
 *
 *     "A ruhsat carries vehicle identification rather than an expiry date."
 *
 * A Turkish ruhsat carries both. The inspection deadline is printed in its
 * (Z.2) DİĞER BİLGİLER field, 24 of the 25 documents were ruhsat photos, and
 * every one of those deadlines was read, parsed, stored in
 * `ocr_extracted_json` — and then discarded by an early return keyed on
 * `doc_type` before anything looked at the dates.
 *
 * The rule now is: a deadline counts wherever it was printed. The document type
 * decides which fields to LOOK for, not whether a date found there is real.
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

function seedBike(id: string, userId: string, plate: string | null): void {
  getDb()
    .prepare("INSERT INTO bike (id, user_id, nickname, plate) VALUES (?, ?, 'B', ?)")
    .run(id, userId, plate);
}

function seedDocument(id: string, userId: string, bikeId: string | null): void {
  getDb()
    .prepare(
      `INSERT INTO document (id, user_id, bike_id, file_path, mime_type, size_bytes, ocr_status)
       VALUES (?, ?, ?, '/tmp/x.jpg', 'image/jpeg', 1, 'done')`,
    )
    .run(id, userId, bikeId);
}

function datedItems(bikeId: string) {
  return getDb()
    .prepare("SELECT type, expires_on, needs_review FROM dated_item WHERE bike_id = ? ORDER BY type")
    .all(bikeId) as { type: string; expires_on: string; needs_review: number }[];
}

beforeEach(() => {
  resetDbForTests();
  runMigrations();
});

describe("applicableDatedItems", () => {
  it("returns a ruhsat's inspection deadline — the case that was being dropped", () => {
    expect(applicableDatedItems(parsed({ dates: { sigortaExpiresOn: null, kaskoExpiresOn: null, muayeneExpiresOn: "2026-08-19" } }))).toEqual([
      { type: "muayene", expiresOn: "2026-08-19" },
    ]);
  });

  it("returns every deadline a document carries, not just the one matching its type", () => {
    const out = applicableDatedItems(
      parsed({
        docType: "sigorta",
        dates: { sigortaExpiresOn: "2027-01-01", kaskoExpiresOn: "2027-02-02", muayeneExpiresOn: "2027-03-03" },
      }),
    );
    expect(out).toEqual([
      { type: "muayene", expiresOn: "2027-03-03" },
      { type: "sigorta", expiresOn: "2027-01-01" },
      { type: "kasko", expiresOn: "2027-02-02" },
    ]);
  });

  it("returns nothing when the document carries no deadline", () => {
    expect(applicableDatedItems(parsed())).toEqual([]);
  });
});

describe("autoApply — a ruhsat becomes a reminder", () => {
  it("creates the muayene dated_item from a ruhsat scan", () => {
    seedUser("u1");
    seedBike("b1", "u1", "34ABC123");
    seedDocument("d1", "u1", "b1");

    const out = autoApply({
      db: getDb(),
      userId: "u1",
      documentId: "d1",
      bikeIdHint: "b1",
      parsed: parsed({
        plate: "34ABC123",
        dates: { sigortaExpiresOn: null, kaskoExpiresOn: null, muayeneExpiresOn: "2026-08-19" },
      }),
      threshold: 0.7,
    });

    expect(out.reason).toBe("applied");
    expect(out.appliedDatedItemId).not.toBeNull();
    expect(datedItems("b1")).toEqual([{ type: "muayene", expires_on: "2026-08-19", needs_review: 1 }]);
  });

  it("still flags what it creates for review", () => {
    // Auto-apply saves the typing, not the checking. Nothing lands unmarked.
    seedUser("u1");
    seedBike("b1", "u1", "34ABC123");
    seedDocument("d1", "u1", "b1");
    autoApply({
      db: getDb(),
      userId: "u1",
      documentId: "d1",
      bikeIdHint: "b1",
      parsed: parsed({ dates: { sigortaExpiresOn: null, kaskoExpiresOn: null, muayeneExpiresOn: "2026-08-19" } }),
      threshold: 0.7,
    });
    expect(datedItems("b1")[0]!.needs_review).toBe(1);
  });

  it("does not duplicate the deadline when the same card is photographed again", () => {
    // The corpus is twenty photographs of one registration card. Twenty
    // identical reminders for one inspection is not twenty times the feature.
    seedUser("u1");
    seedBike("b1", "u1", "34ABC123");
    const p = parsed({ dates: { sigortaExpiresOn: null, kaskoExpiresOn: null, muayeneExpiresOn: "2026-08-19" } });

    for (const doc of ["d1", "d2", "d3"]) {
      seedDocument(doc, "u1", "b1");
      autoApply({ db: getDb(), userId: "u1", documentId: doc, bikeIdHint: "b1", parsed: p, threshold: 0.7 });
    }
    expect(datedItems("b1")).toHaveLength(1);
  });

  it("creates a new row when the deadline itself has moved on", () => {
    seedUser("u1");
    seedBike("b1", "u1", "34ABC123");
    seedDocument("d1", "u1", "b1");
    seedDocument("d2", "u1", "b1");
    autoApply({
      db: getDb(),
      userId: "u1",
      documentId: "d1",
      bikeIdHint: "b1",
      parsed: parsed({ dates: { sigortaExpiresOn: null, kaskoExpiresOn: null, muayeneExpiresOn: "2026-08-19" } }),
      threshold: 0.7,
    });
    autoApply({
      db: getDb(),
      userId: "u1",
      documentId: "d2",
      bikeIdHint: "b1",
      parsed: parsed({ dates: { sigortaExpiresOn: null, kaskoExpiresOn: null, muayeneExpiresOn: "2028-08-19" } }),
      threshold: 0.7,
    });
    expect(datedItems("b1")).toHaveLength(2);
  });

  it("writes every deadline a policy carries", () => {
    seedUser("u1");
    seedBike("b1", "u1", "34ABC123");
    seedDocument("d1", "u1", "b1");
    autoApply({
      db: getDb(),
      userId: "u1",
      documentId: "d1",
      bikeIdHint: "b1",
      parsed: parsed({
        docType: "sigorta",
        dates: { sigortaExpiresOn: "2027-01-01", kaskoExpiresOn: "2027-02-02", muayeneExpiresOn: null },
      }),
      threshold: 0.7,
    });
    expect(datedItems("b1").map((d) => d.type)).toEqual(["kasko", "sigorta"]);
  });

  it("reports a ruhsat with no readable deadline as bike_only, not a failure", () => {
    seedUser("u1");
    seedBike("b1", "u1", "34ABC123");
    seedDocument("d1", "u1", "b1");
    const out = autoApply({
      db: getDb(),
      userId: "u1",
      documentId: "d1",
      bikeIdHint: "b1",
      parsed: parsed(),
      threshold: 0.7,
    });
    expect(out.reason).toBe("bike_only");
    expect(datedItems("b1")).toHaveLength(0);
  });

  it("still refuses to apply below the confidence threshold", () => {
    // The plate validator drops confidence when it rejects a plate; that has to
    // keep meaning "do not write anything".
    seedUser("u1");
    seedBike("b1", "u1", "34ABC123");
    seedDocument("d1", "u1", "b1");
    const out = autoApply({
      db: getDb(),
      userId: "u1",
      documentId: "d1",
      bikeIdHint: "b1",
      parsed: parsed({
        confidence: 0.5,
        dates: { sigortaExpiresOn: null, kaskoExpiresOn: null, muayeneExpiresOn: "2026-08-19" },
      }),
      threshold: 0.7,
    });
    expect(out.reason).toBe("low_confidence");
    expect(datedItems("b1")).toHaveLength(0);
  });

  it("does not invent a vehicle to hang a deadline on", () => {
    // No hint, no plate match, more than one candidate: there is no vehicle
    // this deadline belongs to, and guessing would put it on the wrong one.
    seedUser("u1");
    seedBike("b1", "u1", "34ABC123");
    seedBike("b2", "u1", "34XYZ789");
    seedDocument("d1", "u1", null);
    const out = autoApply({
      db: getDb(),
      userId: "u1",
      documentId: "d1",
      bikeIdHint: null,
      parsed: parsed({
        docType: "muayene",
        plate: "35QQQ111",
        dates: { sigortaExpiresOn: null, kaskoExpiresOn: null, muayeneExpiresOn: "2026-08-19" },
      }),
      threshold: 0.7,
    });
    expect(out.reason).toBe("no_bike_match");
    expect(datedItems("b1")).toHaveLength(0);
    expect(datedItems("b2")).toHaveLength(0);
  });
});
