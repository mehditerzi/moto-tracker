import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { readLocally } from "../src/ocr/localRead.js";
import { readRuhsat, detectLabel, deHomoglyph, repairVinForMake, type OcrLine } from "../src/ocr/ruhsatLayout.js";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";
import { __resetRunVisionOcrForTests, __setRunVisionOcrForTests } from "../src/ocr/worker.js";

/**
 * A fictional ruhsat laid out the way Apple Vision returns a real one: labels
 * with their values just below, two columns, the owner block on the right, and
 * the OCR damage seen in the production corpus (garbled labels, a Cyrillic
 * glyph, a misread WMI letter, the inspection note in 6pt shorthand).
 */
const L = (t: string, x: number, y: number, w = 0.12, h = 0.012): OcrLine => ({ t, x, y, w, h });
const CARD: OcrLine[] = [
  L("(Y.1) VERİLDİĞİ İL/İLÇE", 0.06, 0.28, 0.17),
  L("KAHRAMANMARAŞ / KAHRAMANMARAŞ 9 NOTERLİĞİ", 0.09, 0.3, 0.34),
  L("(A) PLAKA", 0.06, 0.315, 0.08),
  L("(B)TLK TISCE LR", 0.27, 0.318, 0.15),
  L("46 ABC 973", 0.09, 0.331, 0.1),
  L("04/01/2016", 0.3, 0.334, 0.08),
  L("TİCARİ ÜNVANI", 0.58, 0.33, 0.1),
  L("ÖRNEK TİCARET", 0.6, 0.345, 0.12),
  L("(D.I) MARKASI", 0.05, 0.385, 0.1),
  L("(Đ.2) TÍPİ", 0.27, 0.384, 0.07),
  L("YAMAHA", 0.05, 0.402, 0.07),
  L("RN29", 0.36, 0.397, 0.04),
  L("(D.3) TICARI ADI", 0.05, 0.417, 0.12),
  L("(D.4) MODEL YIAJ31ARALAE", 0.27, 0.418, 0.21),
  L("2015", 0.3, 0.435, 0.04),
  L("ИТ 09", 0.04, 0.439, 0.04),
  L("(R) RENGI", 0.27, 0.452, 0.08),
  L("SIYAH", 0.34, 0.468, 0.05),
  L("(P.5) MOTOR NO", 0.045, 0.49, 0.11),
  L("N701E099999", 0.19, 0.504, 0.13),
  L("(E) SASENO", 0.04, 0.523, 0.09),
  L("JVARN296000099999", 0.15, 0.539, 0.2),
  L("(22 BIDER BİLGILER", 0.55, 0.594, 0.16),
  L("un gec th: 19-08-2026", 0.54, 0.609, 0.17),
  L("(S.2) AYAKTA YOLCU SAYISI", 0.25, 0.628, 0.21),
  L("(P.I) SİLİNDİR HACMİ", 0.03, 0.665, 0.16),
  L("847 cm3", 0.06, 0.683, 0.04),
  L("(P.3) YAKIT CINSI", 0.03, 0.703, 0.13),
  L("BENZİNLİ", 0.05, 0.719, 0.08),
];

describe("ruhsat layout reader", () => {
  it("reads every field off a damaged card, without a model", () => {
    const p = readLocally({ text: CARD.map((l) => l.t).join("\n"), lines: CARD });
    expect(p.docType).toBe("ruhsat");
    expect(p.plate).toBe("46ABC973");
    expect(p.make?.toUpperCase()).toBe("YAMAHA");
    expect(p.model).toBe("MT-09"); // "ИТ 09" → homoglyph → catalogue model with the same digits
    expect(p.year).toBe(2015);
    expect(p.firstRegistrationDate).toBe("2016-01-04");
    expect(p.engineNo).toBe("N701E099999");
    expect(p.chassisNo).toBe("JYARN296000099999"); // WMI "JVA" repaired to Yamaha's "JYA"
    expect(p.cylinderCc).toBe(847);
    expect(p.fuelType).toBe("Benzin");
    expect(p.color).toBe("SİYAH");
    expect(p.dates.muayeneExpiresOn).toBe("2026-08-19");
    expect(p.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("does not take a city, the owner's trade name or a lookalike label for a field", () => {
    expect(detectLabel("KAHRAMANMARAŞ / KAHRAMANMARAŞ 9 NOTERLİĞİ")).toBeNull(); // MARAŞ ≈ MARKA
    expect(detectLabel("TİCARİ ÜNVANI")).toBeNull();
    expect(detectLabel("(S.2) AYAKTA YOLCU SAYISI")?.key).not.toBe("fuel"); // AYAKTA ≈ YAKIT
    expect(detectLabel("(D.I) MARKASI")?.key).toBe("make");
    expect(detectLabel("(E) SASENO")?.key).toBe("chassis");
  });

  it("works from plain text in reading order too", () => {
    const text = [
      "(A) PLAKA", "34 XYZ 123", "(D.1) MARKASI", "HONDA", "(D.3) TİCARİ ADI", "ADV750",
      "(D.4) MODEL YILI", "2024", "(E) ŞASE NO", "JH2RH10A4RK399999", "(P.5) MOTOR NO", "RH10E5099999",
      "(Z.2) DİĞER BİLGİLER", "mua. geç. trh: 17-05-2027",
    ].join("\n");
    const p = readLocally({ text });
    expect(p.docType).toBe("ruhsat");
    expect(p.make?.toUpperCase()).toBe("HONDA");
    expect(p.chassisNo).toBe("JH2RH10A4RK399999");
    expect(p.engineNo).toBe("RH10E5099999");
    expect(p.dates.muayeneExpiresOn).toBe("2027-05-17");
  });

  it("leaves a field empty rather than guessing", () => {
    const r = readRuhsat([L("(D.1) MARKASI", 0.05, 0.38), L("İSTANBUL", 0.05, 0.4)]);
    expect(r.make).toBeNull(); // not in the catalogue → not a make
  });

  it("helpers", () => {
    expect(deHomoglyph("ВМW")).toBe("BMW");
    expect(repairVinForMake("1DM9A00AARB000001", "DUCATI")).toBe("ZDM9A00AARB000001");
    expect(repairVinForMake("ZDM9A00AARB000001", "DUCATI")).toBe("ZDM9A00AARB000001");
  });
});

describe("upload with the phone's OCR", () => {
  afterEach(() => __resetRunVisionOcrForTests());

  it("finishes the document inside the request when the device already read it", async () => {
    // Use the real pipeline (the default) — no model is reachable in tests, so
    // only the stage-0 path can finish this.
    __resetRunVisionOcrForTests();
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#ccc" } }).jpeg().toBuffer();
    const res = await request(app)
      .post("/api/documents")
      .set("Cookie", cookie)
      .field("ocr", JSON.stringify({ lines: CARD }))
      .attach("file", jpeg, { filename: "r.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(201);
    expect(res.body.ocrStatus).toBe("done");
    expect(res.body.docType).toBe("ruhsat");
    expect(res.body.ocrExtracted.plate).toBe("46ABC973");
    expect(res.body.ocrExtracted.pipeline).toMatch(/^device-ocr\(\d+\) > local\(ruhsat/);
  });

  it("queues as before when the device reading is not enough", async () => {
    let ran = false;
    __setRunVisionOcrForTests(async (_f, _s, hints?: { fastOnly?: boolean }) => {
      if (hints?.fastOnly) {
        const { FastPathMiss } = await import("../src/ocr/worker.js");
        throw new FastPathMiss();
      }
      ran = true;
      return { rawText: '{"doc_type":"unknown","confidence":0}', model: "stub" };
    });
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#ccc" } }).jpeg().toBuffer();
    const res = await request(app)
      .post("/api/documents")
      .set("Cookie", cookie)
      .field("ocr", JSON.stringify({ lines: [{ t: "blur", x: 0, y: 0, w: 0.1, h: 0.1 }] }))
      .attach("file", jpeg, { filename: "r.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(201);
    expect(res.body.ocrStatus).toBe("pending");
    await new Promise((r) => setTimeout(r, 200));
    expect(ran).toBe(true);
  });
});
