import { describe, it, expect } from "vitest";
import { isValidTrPlate, correctTrPlate, validateAndCorrect } from "../src/ocr/validators.js";
import type { ParsedOcr } from "../src/ocr/parser.js";

/**
 * Plate structure and OCR confusion correction.
 *
 * `plate` is not a caption — `autoApply` matches vehicles on it and will create
 * a vehicle from it. So the bar is: never store a string that cannot be a
 * Turkish registration, and when the string is one glyph away from a legal
 * plate, fix it in the group where that glyph is possible and nowhere else.
 *
 * The failures below are real production extractions with the province and
 * digits altered; the SHAPES are exactly what the pipeline produced.
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
    confidence: 0.9,
    ...over,
  };
}

describe("isValidTrPlate — the issued combinations, and only those", () => {
  it("accepts every legal letter/digit split", () => {
    for (const p of [
      "06A1234", // 1 + 4
      "34A12345", // 1 + 5
      "35AB123", // 2 + 3
      "34LB4147", // 2 + 4
      "07ABC12", // 3 + 2
      "34ABC123", // 3 + 3
    ]) {
      expect(isValidTrPlate(p), p).toBe(true);
    }
  });

  it("rejects four letters — the shape production stored with confidence 0.9", () => {
    expect(isValidTrPlate("34KEHL973")).toBe(false);
  });

  it("rejects splits that are not issued", () => {
    expect(isValidTrPlate("34AB12")).toBe(false); // 2 + 2, too short
    expect(isValidTrPlate("34ABC1234")).toBe(false); // 3 + 4, too long
    expect(isValidTrPlate("34A123")).toBe(false); // 1 + 3
  });

  it("rejects an out-of-range province", () => {
    expect(isValidTrPlate("00ABC12")).toBe(false);
    expect(isValidTrPlate("82ABC12")).toBe(false);
    expect(isValidTrPlate("99ABC12")).toBe(false);
  });

  it("requires digits after letters, not interleaved", () => {
    expect(isValidTrPlate("34A1B23")).toBe(false);
  });
});

describe("correctTrPlate — confusions, in the right group only", () => {
  it("fixes S read for 5 inside the DIGIT group", () => {
    // Production stored "34GTC6S6" for a vehicle registered 34GTC656.
    expect(correctTrPlate("34GTC6S6")).toEqual({ plate: "34GTC656", corrections: 1 });
  });

  it("fixes O/I/B read for 0/1/8 inside the digit group", () => {
    expect(correctTrPlate("34ABC1O3")?.plate).toBe("34ABC103");
    expect(correctTrPlate("34ABCI23")?.plate).toBe("34ABC123");
    expect(correctTrPlate("34ABC12B")?.plate).toBe("34ABC128");
  });

  it("fixes 0/5 read for O/S inside the LETTER group", () => {
    expect(correctTrPlate("340BC123")?.plate).toBe("34OBC123");
    expect(correctTrPlate("345BC123")?.plate).toBe("34SBC123");
  });

  it("leaves an ambiguous string alone when it already reads as a legal plate", () => {
    // "34AB0123" could be read as 3 letters + 3 digits with the 0 corrected to
    // an O — but it is already legal as 2 letters + 4 digits, and a correction
    // nobody needs is just a way to damage a plate that was read correctly.
    expect(correctTrPlate("34AB0123")).toEqual({ plate: "34AB0123", corrections: 0 });
  });

  it("does NOT apply the digit fix to a letter or vice versa", () => {
    // "34GTC656" is already legal. Nothing may turn its 5 into an S.
    expect(correctTrPlate("34GTC656")).toEqual({ plate: "34GTC656", corrections: 0 });
    // "34SBC123" is already legal. Nothing may turn its S into a 5.
    expect(correctTrPlate("34SBC123")).toEqual({ plate: "34SBC123", corrections: 0 });
  });

  it("fixes a province misread as letters", () => {
    expect(correctTrPlate("3SABC123")?.plate).toBe("35ABC123");
    expect(correctTrPlate("OBABC123")?.plate).toBe("08ABC123");
  });

  it("normalises spacing and Turkish letters", () => {
    expect(correctTrPlate("34 gtc 6s6")?.plate).toBe("34GTC656");
    expect(correctTrPlate("34 İST 123")?.plate).toBe("34IST123");
  });

  it("refuses a plate with no legal reading", () => {
    expect(correctTrPlate("34KEHL973")).toBeNull(); // four letters, unrecoverable
    expect(correctTrPlate("XYZ")).toBeNull();
    expect(correctTrPlate("99ABC12")).toBeNull(); // province out of range
    expect(correctTrPlate("")).toBeNull();
    expect(correctTrPlate(null)).toBeNull();
  });

  it("prefers the reading that needs fewest edits", () => {
    // "34AB1234" splits legally as 2+4 with zero corrections; it must not be
    // "corrected" into some 1+5 or 3+3 reading instead.
    expect(correctTrPlate("34AB1234")).toEqual({ plate: "34AB1234", corrections: 0 });
  });
});

describe("validateAndCorrect — what reaches the database", () => {
  it("repairs a fixable plate and says so, keeping confidence", () => {
    const { parsed: out, issues } = validateAndCorrect(parsed({ plate: "34GTC6S6", confidence: 0.9 }));
    expect(out.plate).toBe("34GTC656");
    expect(issues.some((i) => i.field === "plate" && i.kind === "corrected")).toBe(true);
    expect(out.confidence).toBe(0.9);
  });

  it("DROPS an impossible plate and drags confidence under the apply threshold", () => {
    // This is the one that matters. Production stored "34KEHL973" at
    // confidence 0.9 — above OCR_AUTO_APPLY_THRESHOLD, so autoApply was one
    // matching document away from creating a vehicle registered to a plate
    // that cannot exist.
    const { parsed: out, issues } = validateAndCorrect(parsed({ plate: "34KEHL973", confidence: 0.9 }));
    expect(out.plate).toBeNull();
    expect(out.confidence).toBeLessThan(0.7);
    const issue = issues.find((i) => i.field === "plate");
    expect(issue?.kind).toBe("suspect");
    // The rejected text survives in the message so review can show what was read.
    expect(issue?.message).toContain("34KEHL973");
  });

  it("treats a heavily-edited plate as suspect rather than confidently corrected", () => {
    const { parsed: out, issues } = validateAndCorrect(parsed({ plate: "3SABCI23", confidence: 0.9 }));
    expect(out.plate).toBe("35ABC123");
    expect(issues.some((i) => i.field === "plate" && i.kind === "suspect")).toBe(true);
    expect(out.confidence).toBeLessThan(0.7);
  });

  it("leaves an already-legal plate exactly as read", () => {
    const { parsed: out, issues } = validateAndCorrect(parsed({ plate: "46 AHL 973" }));
    expect(out.plate).toBe("46 AHL 973");
    expect(issues.some((i) => i.field === "plate")).toBe(false);
  });

  it("cannot and does not pretend to fix a transposition", () => {
    // "36ALH973" is structurally perfect and completely wrong — the vehicle is
    // 46AHL973. Two OCR reads of one card disagreed on both the province and
    // the letter order. No structural rule can recover this, and inventing one
    // would corrupt correct plates; it passes through untouched, on purpose.
    const { parsed: out, issues } = validateAndCorrect(parsed({ plate: "36ALH973" }));
    expect(out.plate).toBe("36ALH973");
    expect(issues).toHaveLength(0);
  });
});
