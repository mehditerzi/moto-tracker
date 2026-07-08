import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import fs from "node:fs/promises";
import sharp from "sharp";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";
import {
  __setRunVisionOcrForTests,
  __resetRunVisionOcrForTests,
} from "../src/ocr/worker.js";
import { config } from "../src/config.js";

// Own uploads dir: documents.test.ts runs in a parallel worker and rm's the
// shared default between our mkdir and write, 500-ing uploads intermittently.
const UPLOADS = "/tmp/mototracker-test-uploads-fuel";
(config as { UPLOADS_DIR: string }).UPLOADS_DIR = UPLOADS;

async function makeJpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .jpeg()
    .toBuffer();
}

async function createBike(app: ReturnType<typeof buildTestApp>, cookie: string, plate?: string) {
  const res = await request(app)
    .post("/api/bikes")
    .set("Cookie", cookie)
    .set("Content-Type", "application/json")
    .send({ nickname: "B1", plate: plate ?? null });
  return res.body.id as string;
}

async function waitForDoc(
  app: ReturnType<typeof buildTestApp>,
  cookie: string,
  id: string,
  timeoutMs = 5000,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request(app).get(`/api/documents/${id}`).set("Cookie", cookie);
    if (res.body.ocrStatus !== "pending") return res.body;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("OCR did not finish in time");
}

function stubYakit(overrides: Record<string, unknown> = {}, fuel: Record<string, unknown> = {}) {
  __setRunVisionOcrForTests(async () => ({
    rawText: JSON.stringify({
      doc_type: "yakit",
      plate: "34 ABC 123",
      fuel: {
        filled_on: "2026-07-02",
        liters: 12.45,
        total_cost: 1037.93,
        unit_price: 83.37,
        ...fuel,
      },
      confidence: 0.9,
      ...overrides,
    }),
    model: "test-model",
  }));
}

async function uploadDoc(app: ReturnType<typeof buildTestApp>, cookie: string) {
  const buf = await makeJpeg();
  const post = await request(app)
    .post("/api/documents")
    .set("Cookie", cookie)
    .attach("file", buf, { filename: "receipt.jpg", contentType: "image/jpeg" });
  expect(post.status).toBe(201);
  return post.body.id as string;
}

describe("fuel receipt OCR", () => {
  afterEach(async () => {
    __resetRunVisionOcrForTests();
    await fs.rm(UPLOADS, { recursive: true, force: true }).catch(() => {});
  });

  it("auto-applies a confident receipt as a fuel_log on the plate-matched bike", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bikeId = await createBike(app, cookie, "34 ABC 123");
    stubYakit();

    const docId = await uploadDoc(app, cookie);
    const finished = await waitForDoc(app, cookie, docId);
    expect(finished.docType).toBe("yakit");
    expect(finished.appliedFuelLogId).toBeTruthy();

    const logs = await request(app).get(`/api/fuel-logs?bikeId=${bikeId}`).set("Cookie", cookie);
    expect(logs.body).toHaveLength(1);
    expect(logs.body[0]).toMatchObject({
      filledOn: "2026-07-02",
      liters: 12.45,
      totalCost: 1037.93,
      isFull: true,
      sourceDocumentId: docId,
    });
  });

  it("does NOT auto-apply below the confidence threshold but keeps fuel data for review", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    await createBike(app, cookie, "34 ABC 123");
    stubYakit({ confidence: 0.4 });

    const docId = await uploadDoc(app, cookie);
    const finished = await waitForDoc(app, cookie, docId);
    expect(finished.appliedFuelLogId).toBeNull();
    expect(finished.ocrExtracted.fuel.liters).toBe(12.45);

    const logs = await request(app).get("/api/fuel-logs").set("Cookie", cookie);
    expect(logs.body).toHaveLength(0);
  });

  it("derives a missing total from litres × unit price before applying", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bikeId = await createBike(app, cookie, "34 ABC 123");
    stubYakit({}, { total_cost: null });

    const docId = await uploadDoc(app, cookie);
    const finished = await waitForDoc(app, cookie, docId);
    expect(finished.appliedFuelLogId).toBeTruthy();

    const logs = await request(app).get(`/api/fuel-logs?bikeId=${bikeId}`).set("Cookie", cookie);
    // 12.45 × 83.37 rounded to kuruş
    expect(logs.body[0].totalCost).toBeCloseTo(1037.96, 2);
  });

  it("a mismatched total caps confidence so nothing auto-applies", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    await createBike(app, cookie, "34 ABC 123");
    stubYakit({}, { total_cost: 500 }); // 12.45 × 83.37 ≈ 1038, way off

    const docId = await uploadDoc(app, cookie);
    const finished = await waitForDoc(app, cookie, docId);
    expect(finished.appliedFuelLogId).toBeNull();

    const logs = await request(app).get("/api/fuel-logs").set("Cookie", cookie);
    expect(logs.body).toHaveLength(0);
  });

  it("no plate match → no auto-apply, receipt stays for manual review", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    await createBike(app, cookie, "06 XYZ 42"); // different plate
    stubYakit();

    const docId = await uploadDoc(app, cookie);
    const finished = await waitForDoc(app, cookie, docId);
    expect(finished.appliedFuelLogId).toBeNull();

    const logs = await request(app).get("/api/fuel-logs").set("Cookie", cookie);
    expect(logs.body).toHaveLength(0);
  });

  it("manual save from review links the fuel log to its scan", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bikeId = await createBike(app, cookie, "06 XYZ 42");
    stubYakit(); // plate mismatch → not auto-applied

    const docId = await uploadDoc(app, cookie);
    await waitForDoc(app, cookie, docId);

    const res = await request(app)
      .post("/api/fuel-logs")
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send({
        bikeId,
        filledOn: "2026-07-02",
        liters: 12.45,
        totalCost: 1037.93,
        isFull: true,
        sourceDocumentId: docId,
      });
    expect(res.status).toBe(201);
    expect(res.body.sourceDocumentId).toBe(docId);
  });
});
