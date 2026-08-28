import { describe, it, expect } from "vitest";
import type { Bike, Document, OcrExtracted, ReviewDecision } from "@mototracker/shared";
import {
  attentionFields,
  batchStats,
  canConfirm,
  duplicateWithinBatch,
  isOneTap,
  nextUndecidedIndex,
  outcomeOf,
  seedDecision,
  suggestNickname,
  normalizePlate,
} from "./batchModel";

function extracted(over: Partial<OcrExtracted> = {}): OcrExtracted {
  return {
    docType: "ruhsat",
    plate: "34 ABC 123",
    make: "Ducati",
    model: "Monster 937",
    year: 2023,
    dates: { sigortaExpiresOn: null, kaskoExpiresOn: null, muayeneExpiresOn: null },
    confidence: 0.9,
    ...over,
  };
}

let seq = 0;
function doc(over: Partial<Document> = {}): Document {
  seq += 1;
  return {
    id: `doc-${seq}`,
    userId: "u1",
    bikeId: null,
    filePath: "/x.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 100,
    docType: "ruhsat",
    ocrExtracted: extracted(),
    ocrStatus: "done",
    ocrModel: "m",
    ocrError: null,
    appliedDatedItemId: null,
    appliedFuelLogId: null,
    batchId: "b1",
    batchSeq: seq,
    reviewState: "pending",
    reviewDecision: null,
    suggestedBikeId: null,
    suggestion: "create",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...over,
  };
}

function bike(over: Partial<Bike> = {}): Bike {
  return {
    id: "bike-1",
    userId: "u1",
    orgId: null,
    vehicleType: "motorcycle",
    nickname: "Monster",
    plate: "34 ABC 123",
    make: null,
    model: "Custom Build",
    year: null,
    currentKm: null,
    color: null,
    chassisNo: null,
    engineNo: null,
    cylinderCc: null,
    fuelType: null,
    firstRegistrationDate: null,
    photoUrl: null,
    archived: false,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...over,
  } as Bike;
}

describe("attentionFields", () => {
  it("stays quiet when everything core was read confidently", () => {
    expect([...attentionFields(doc())]).toEqual([]);
  });

  it("points at a core field OCR could not read", () => {
    const d = doc({ ocrExtracted: extracted({ plate: null }) });
    expect([...attentionFields(d)]).toEqual(["plate"]);
  });

  it("ignores a missing non-core field — a blank colour is not a problem", () => {
    const d = doc({ ocrExtracted: extracted({ color: null, chassisNo: null }) });
    expect([...attentionFields(d)]).toEqual([]);
  });

  it("raises a field the validators called suspect, even at high confidence", () => {
    const d = doc({
      ocrExtracted: extracted({
        confidence: 0.95,
        issues: [{ field: "engineNo", kind: "suspect", message: "Motor numarası geçersiz görünüyor" }],
      }),
    });
    expect([...attentionFields(d)]).toEqual(["engineNo"]);
  });

  it("does not raise a field it merely corrected — that is information, not a fault", () => {
    const d = doc({
      ocrExtracted: extracted({
        issues: [{ field: "make", kind: "corrected", message: "Marka kataloğa göre düzeltildi" }],
      }),
    });
    expect([...attentionFields(d)]).toEqual([]);
  });

  it("raises everything core when the parse as a whole scored badly", () => {
    const d = doc({ ocrExtracted: extracted({ confidence: 0.4 }) });
    expect([...attentionFields(d)].sort()).toEqual(["make", "model", "plate", "year"]);
  });

  it("does not demand a make and model from an insurance policy", () => {
    // A sigorta carries a plate and a date, nothing else. Flagging four blank
    // identity fields on every one would teach the user to ignore the warning.
    const d = doc({
      ocrExtracted: extracted({ docType: "sigorta", make: null, model: null, year: null }),
    });
    expect([...attentionFields(d)]).toEqual([]);
  });
});

describe("isOneTap", () => {
  it("is true for a clean, confident ruhsat", () => {
    expect(isOneTap(doc())).toBe(true);
  });

  it("is false while the document is still being read", () => {
    expect(isOneTap(doc({ ocrStatus: "pending", ocrExtracted: null }))).toBe(false);
  });

  it("is false for a low-confidence parse", () => {
    expect(isOneTap(doc({ ocrExtracted: extracted({ confidence: 0.5 }) }))).toBe(false);
  });

  it("is false for a document that is not a registration", () => {
    expect(isOneTap(doc({ ocrExtracted: extracted({ docType: "sigorta" }) }))).toBe(false);
  });
});

describe("outcomeOf", () => {
  it("never leaves a document without a shape to render", () => {
    const cases: Array<[Document, string]> = [
      [doc({ ocrStatus: "pending", ocrExtracted: null }), "reading"],
      [doc({ ocrStatus: "failed", ocrExtracted: null }), "unreadable"],
      [doc({ suggestion: "none" }), "unreadable"],
      [doc({ suggestion: "org_conflict" }), "org_conflict"],
      [doc({ suggestion: "update" }), "update"],
      [doc({ suggestion: "create" }), "create"],
      [doc({ ocrExtracted: extracted({ docType: "sigorta" }), suggestion: "create" }), "not_a_ruhsat"],
      // A dated document that names a vehicle we know is still useful.
      [doc({ ocrExtracted: extracted({ docType: "sigorta" }), suggestion: "update" }), "update"],
    ];
    for (const [d, expected] of cases) expect(outcomeOf(d)).toBe(expected);
  });
});

describe("seedDecision", () => {
  it("proposes creating a vehicle, named from what was read", () => {
    const decision = seedDecision(doc(), undefined);
    expect(decision.action).toBe("create");
    expect(decision.nickname).toBe("Ducati Monster 937");
    expect(decision.fields.plate).toBe("34 ABC 123");
  });

  it("fills the vehicle's blanks on an update but never overwrites what it knows", () => {
    const d = doc({ suggestion: "update", suggestedBikeId: "bike-1" });
    const decision = seedDecision(d, bike());
    expect(decision.action).toBe("update");
    expect(decision.targetBikeId).toBe("bike-1");
    // make was blank on the vehicle — the scan fills it.
    expect(decision.fields.make).toBe("Ducati");
    // model was set by hand — the scan must not silently replace it.
    expect(decision.fields.model).toBe("Custom Build");
  });

  it("carries the dates the document itself gave up", () => {
    const d = doc({
      ocrExtracted: extracted({
        dates: { sigortaExpiresOn: null, kaskoExpiresOn: null, muayeneExpiresOn: "2027-03-01" },
      }),
    });
    expect(seedDecision(d, undefined).dates).toEqual({ muayene: "2027-03-01" });
  });

  it("defaults a document that is not a ruhsat to skip rather than to a wrong write", () => {
    const d = doc({ ocrExtracted: extracted({ docType: "kasko" }), suggestion: "create" });
    expect(seedDecision(d, undefined).action).toBe("skip");
  });
});

describe("canConfirm", () => {
  const base: ReviewDecision = { action: "create", fields: {}, dates: {} };

  it("refuses a nameless vehicle", () => {
    expect(canConfirm({ ...base, fields: { plate: "34 ABC 123" } })).toBe(false);
  });

  it("refuses a named vehicle with nothing identifying it", () => {
    expect(canConfirm({ ...base, nickname: "Motor" })).toBe(false);
  });

  it("accepts a name plus a plate", () => {
    expect(canConfirm({ ...base, nickname: "Motor", fields: { plate: "34 ABC 123" } })).toBe(true);
  });

  it("accepts a chassis number when the plate could not be read", () => {
    expect(
      canConfirm({ ...base, nickname: "Motor", fields: { chassisNo: "ZDMxxxxxxxxxxxxxx" } }),
    ).toBe(true);
  });

  it("needs a target for an update, and nothing at all for a skip", () => {
    expect(canConfirm({ action: "update", targetBikeId: null, fields: {}, dates: {} })).toBe(false);
    expect(canConfirm({ action: "update", targetBikeId: "b", fields: {}, dates: {} })).toBe(true);
    expect(canConfirm({ action: "skip", fields: {}, dates: {} })).toBe(true);
  });
});

describe("nextUndecidedIndex", () => {
  it("wraps, so the easy ones can be cleared first and the hard ones picked up on the way round", () => {
    const docs = [
      doc({ reviewState: "pending" }),
      doc({ reviewState: "confirmed" }),
      doc({ reviewState: "confirmed" }),
    ];
    // From the last document, the only one left is index 0 — behind us.
    expect(nextUndecidedIndex(docs, 2)).toBe(0);
  });

  it("steps over a document still being read rather than stalling on it", () => {
    const docs = [
      doc({ reviewState: "confirmed" }),
      doc({ ocrStatus: "pending", ocrExtracted: null, reviewState: "pending" }),
      doc({ reviewState: "pending" }),
    ];
    expect(nextUndecidedIndex(docs, 0)).toBe(2);
  });

  it("parks on the first unread document when everything readable is decided", () => {
    const docs = [
      doc({ reviewState: "confirmed" }),
      doc({ ocrStatus: "pending", ocrExtracted: null, reviewState: "pending" }),
    ];
    expect(nextUndecidedIndex(docs, 0)).toBe(1);
  });

  it("returns null when there is genuinely nothing left", () => {
    const docs = [doc({ reviewState: "confirmed" }), doc({ reviewState: "skipped" })];
    expect(nextUndecidedIndex(docs, 0)).toBeNull();
  });
});

describe("batchStats", () => {
  it("counts what the header promises", () => {
    const docs = [
      doc({ reviewState: "confirmed", reviewDecision: { action: "create", fields: {}, dates: {} } }),
      doc({
        reviewState: "confirmed",
        reviewDecision: { action: "update", targetBikeId: "b", fields: {}, dates: {} },
      }),
      doc({ reviewState: "skipped" }),
      doc({ ocrStatus: "pending", ocrExtracted: null }),
      doc({ ocrStatus: "failed", ocrExtracted: null }),
    ];
    const s = batchStats(docs);
    expect(s).toMatchObject({
      total: 5,
      reading: 1,
      failed: 1,
      confirmed: 2,
      skipped: 1,
      awaiting: 1,
      creates: 1,
      updates: 1,
    });
    // Not ready: one document is still being read and one still needs a decision.
    expect(s.ready).toBe(false);
  });

  it("is ready only when nothing is unanswered and something will actually happen", () => {
    expect(
      batchStats([
        doc({ reviewState: "confirmed", reviewDecision: { action: "create", fields: {}, dates: {} } }),
        doc({ reviewState: "skipped" }),
      ]).ready,
    ).toBe(true);
    // Everything skipped: applying would write nothing, so the button stays off.
    expect(batchStats([doc({ reviewState: "skipped" })]).ready).toBe(false);
    expect(batchStats([]).ready).toBe(false);
  });
});

describe("duplicateWithinBatch", () => {
  it("spots a second shot of the same plate and points back at the first", () => {
    const a = doc({
      reviewState: "confirmed",
      reviewDecision: { action: "create", fields: { plate: "34 ABC 123" }, dates: {} },
    });
    const b = doc({
      reviewState: "confirmed",
      reviewDecision: { action: "create", fields: { plate: "34abc123" }, dates: {} },
    });
    const dupes = duplicateWithinBatch([a, b]);
    expect(dupes.get(b.id)).toBe(a.id);
    expect(dupes.has(a.id)).toBe(false);
  });

  it("does not call an update a duplicate — that is the point of an update", () => {
    const a = doc({
      reviewState: "confirmed",
      reviewDecision: { action: "create", fields: { plate: "34 ABC 123" }, dates: {} },
    });
    const b = doc({
      reviewState: "confirmed",
      reviewDecision: {
        action: "update",
        targetBikeId: "bike-1",
        fields: { plate: "34 ABC 123" },
        dates: {},
      },
    });
    expect(duplicateWithinBatch([a, b]).size).toBe(0);
  });
});

describe("small helpers", () => {
  it("normalises a plate the way the server does", () => {
    expect(normalizePlate(" 34 abc 123 ")).toBe("34ABC123");
    expect(normalizePlate("   ")).toBeNull();
    expect(normalizePlate(null)).toBeNull();
  });

  it("names a vehicle from the best thing it has", () => {
    expect(suggestNickname({ make: "Fiat", model: "Egea", plate: "34 X" } as never)).toBe("Fiat Egea");
    expect(suggestNickname({ make: "", model: "", plate: "34 ABC 123" } as never)).toBe("34 ABC 123");
    expect(suggestNickname({ make: "", model: "", plate: "" } as never)).toBe("");
  });
});
