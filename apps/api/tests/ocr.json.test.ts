import { describe, it, expect } from "vitest";
import { parseOcr, safeParseOcr, repairJson } from "../src/ocr/parser.js";
import { backstopFromText } from "../src/ocr/backstop.js";

/**
 * Surviving whatever the model actually says.
 *
 * 16% of production scans died in the JSON parser and were recorded as
 * `ocr_status = 'failed'` — the user saw "tarama başarısız" for a photograph
 * whose plate and expiry date were sitting in the OCR text the whole time. Two
 * causes, both of them ours to absorb:
 *
 *   "OCR response did not contain a JSON object"   — the model answered with
 *       prose, or with nothing at all (an empty string, which is what a model
 *       returns when it has been handed an image it cannot see).
 *   "Unexpected end of JSON input"                 — generation hit num_predict
 *       and the object simply stops mid-value.
 *
 * A model that garbles its answer should cost the document its LLM fields. It
 * should never cost the document.
 */

describe("repairJson", () => {
  it("parses what is already valid", () => {
    expect(repairJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("removes trailing commas", () => {
    expect(repairJson('{"a":1,"b":[1,2,],}')).toEqual({ a: 1, b: [1, 2] });
  });

  it("closes an object truncated between members", () => {
    expect(repairJson('{"doc_type":"ruhsat","plate":"34ABC123",')).toEqual({
      doc_type: "ruhsat",
      plate: "34ABC123",
    });
  });

  it("closes nested structure truncated mid-object", () => {
    expect(repairJson('{"doc_type":"ruhsat","dates":{"muayene_expires_on":"2026-08-19",')).toEqual({
      doc_type: "ruhsat",
      dates: { muayene_expires_on: "2026-08-19" },
    });
  });

  it("DISCARDS a value that was cut in half rather than closing the quote", () => {
    // The plate is 34ABC123. Closing the string would "recover" 34ABC1 — a
    // plate that is legal, plausible, and someone else's.
    const out = repairJson('{"doc_type":"ruhsat","plate":"34ABC1') as Record<string, unknown>;
    expect(out).toEqual({ doc_type: "ruhsat" });
    expect(out.plate).toBeUndefined();
  });

  it("gives up rather than guessing", () => {
    expect(repairJson("not json at all")).toBeNull();
  });
});

describe("parseOcr — what models actually return", () => {
  const body = {
    doc_type: "ruhsat",
    plate: "34ABC123",
    dates: { muayene_expires_on: "19-08-2026" },
    confidence: 0.9,
  };

  it("reads a fenced object", () => {
    expect(parseOcr("```json\n" + JSON.stringify(body) + "\n```").plate).toBe("34ABC123");
  });

  it("reads an object wrapped in Turkish prose", () => {
    const r = parseOcr(`Belgeyi inceledim. ${JSON.stringify(body)} Umarım doğrudur.`);
    expect(r.dates.muayeneExpiresOn).toBe("2026-08-19");
  });

  it("reads an object inside an unterminated fence", () => {
    // Truncation cuts the closing fence off too.
    const r = parseOcr("```json\n" + JSON.stringify(body).slice(0, -1) + ",");
    expect(r.docType).toBe("ruhsat");
    expect(r.plate).toBe("34ABC123");
  });

  it("recovers the fields that survived a truncated response", () => {
    const truncated = '{"doc_type":"ruhsat","plate":"34ABC123","make":"YAMAHA","model":"MT-0';
    const r = parseOcr(truncated);
    expect(r.docType).toBe("ruhsat");
    expect(r.plate).toBe("34ABC123");
    expect(r.make).toBe("YAMAHA");
    expect(r.model).toBeNull(); // cut in half — dropped, not half-guessed
  });
});

describe("safeParseOcr — a bad answer is not a failed document", () => {
  it("degrades an empty response to an empty parse", () => {
    const { parsed, error } = safeParseOcr("");
    expect(error).toBeTruthy();
    expect(parsed.docType).toBe("unknown");
    expect(parsed.confidence).toBe(0);
  });

  it("degrades prose with no object at all", () => {
    const { parsed, error } = safeParseOcr("Üzgünüm, bu görüntüyü okuyamadım.");
    expect(error).toBeTruthy();
    expect(parsed.plate).toBeNull();
  });

  it("reports no error when the response was fine", () => {
    const { parsed, error } = safeParseOcr('{"doc_type":"muayene","confidence":0.8}');
    expect(error).toBeUndefined();
    expect(parsed.docType).toBe("muayene");
  });

  it("hands the document to the backstop, which reads it anyway", () => {
    // End to end: the model returned nothing usable, and the scan still
    // produces a type, a plate and a deadline off the OCR text.
    const ocrText = [
      "(A) PLAKA",
      "34ABC123",
      "(B) ILK TESCIL TARIHI",
      "04/01/2016",
      "(D.1) MARKASI",
      "YAMAHA",
      "(E) SASE NO",
      "JYARN296000013322",
      "(P.5) MOTOR NO",
      "N701E033981",
      "(Z.2) DIGER BILGILER",
      "nua.ge; trh: 19-08-2026",
    ].join("\n");

    const { parsed } = safeParseOcr("");
    const recovered = backstopFromText(parsed, ocrText);

    expect(recovered.docType).toBe("ruhsat");
    expect(recovered.plate).toBe("34ABC123");
    expect(recovered.dates.muayeneExpiresOn).toBe("2026-08-19");
    expect(recovered.firstRegistrationDate).toBe("2016-01-04");
    expect(recovered.confidence).toBeGreaterThanOrEqual(0.7);
  });
});
