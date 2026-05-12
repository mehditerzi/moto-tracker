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

describe("/api/documents", () => {
  afterEach(() => {
    __resetRunVisionOcrForTests();
    void fs.rm("/tmp/mototracker-test-uploads", { recursive: true, force: true });
  });

  it("requires auth", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/documents");
    expect(res.status).toBe(401);
  });

  it("uploads, runs OCR (stubbed), auto-applies a sigorta dated_item", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bikeId = await createBike(app, cookie, "34 ABC 123");

    __setRunVisionOcrForTests(async () => ({
      rawText: JSON.stringify({
        doc_type: "sigorta",
        plate: "34 ABC 123",
        dates: { sigorta_expires_on: "2027-06-01" },
        confidence: 0.9,
      }),
      model: "test-model",
    }));

    const buf = await makeJpeg();
    const post = await request(app)
      .post("/api/documents")
      .set("Cookie", cookie)
      .attach("file", buf, { filename: "test.jpg", contentType: "image/jpeg" });
    expect(post.status).toBe(201);
    expect(post.body.ocrStatus).toBe("pending");

    const finished = await waitForDoc(app, cookie, post.body.id);
    expect(finished.ocrStatus).toBe("done");
    expect(finished.docType).toBe("sigorta");
    expect(finished.appliedDatedItemId).toBeTruthy();

    const dash = await request(app).get("/api/dashboard").set("Cookie", cookie);
    expect(dash.body[0].items.sigorta.expiresOn).toBe("2027-06-01");
    expect(dash.body[0].bike.id).toBe(bikeId);
  });

  it("does NOT auto-apply when confidence is below threshold", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    await createBike(app, cookie, "34 ABC 123");

    __setRunVisionOcrForTests(async () => ({
      rawText: JSON.stringify({
        doc_type: "sigorta",
        plate: "34 ABC 123",
        dates: { sigorta_expires_on: "2027-06-01" },
        confidence: 0.4,
      }),
      model: "test-model",
    }));

    const post = await request(app)
      .post("/api/documents")
      .set("Cookie", cookie)
      .attach("file", await makeJpeg(), { filename: "x.jpg", contentType: "image/jpeg" });

    const finished = await waitForDoc(app, cookie, post.body.id);
    expect(finished.ocrStatus).toBe("done");
    expect(finished.appliedDatedItemId).toBeNull();
  });

  it("marks failed when OCR throws", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    await createBike(app, cookie);

    __setRunVisionOcrForTests(async () => {
      throw new Error("ollama unreachable");
    });

    const post = await request(app)
      .post("/api/documents")
      .set("Cookie", cookie)
      .attach("file", await makeJpeg(), { filename: "x.jpg", contentType: "image/jpeg" });
    const finished = await waitForDoc(app, cookie, post.body.id);
    expect(finished.ocrStatus).toBe("failed");
    expect(finished.ocrError).toMatch(/ollama unreachable/);
  });

  it("rejects non-image uploads", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app)
      .post("/api/documents")
      .set("Cookie", cookie)
      .attach("file", Buffer.from("not an image"), {
        filename: "x.txt",
        contentType: "text/plain",
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("does not return another user's document", async () => {
    const app = buildTestApp();
    const u1 = await signUpAndSignIn(app, "alice@test.com");
    const u2 = await signUpAndSignIn(app, "bob@test.com");
    __setRunVisionOcrForTests(async () => ({
      rawText: '{"doc_type":"unknown","plate":null,"dates":{},"confidence":0}',
      model: "x",
    }));
    const post = await request(app)
      .post("/api/documents")
      .set("Cookie", u1.cookie)
      .attach("file", await makeJpeg(), { filename: "x.jpg", contentType: "image/jpeg" });
    const cross = await request(app).get(`/api/documents/${post.body.id}`).set("Cookie", u2.cookie);
    expect(cross.status).toBe(404);
  });

  it("ruhsat scan creates a new bike when the user has no bikes", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);

    __setRunVisionOcrForTests(async () => ({
      rawText: JSON.stringify({
        doc_type: "ruhsat",
        plate: "34 ABC 123",
        make: "Ducati",
        model: "Monster 937",
        year: 2023,
        dates: {},
        confidence: 0.92,
      }),
      model: "test-model",
    }));

    const post = await request(app)
      .post("/api/documents")
      .set("Cookie", cookie)
      .attach("file", await makeJpeg(), { filename: "ruhsat.jpg", contentType: "image/jpeg" });
    const finished = await waitForDoc(app, cookie, post.body.id);

    expect(finished.ocrStatus).toBe("done");
    expect(finished.docType).toBe("ruhsat");
    expect(finished.bikeId).toBeTruthy();
    // No dated_item, because ruhsat doesn't carry an expiry.
    expect(finished.appliedDatedItemId).toBeNull();

    const bikes = await request(app).get("/api/bikes").set("Cookie", cookie);
    expect(bikes.body).toHaveLength(1);
    expect(bikes.body[0].plate).toBe("34 ABC 123");
    expect(bikes.body[0].make).toBe("Ducati");
    expect(bikes.body[0].model).toBe("Monster 937");
    expect(bikes.body[0].year).toBe(2023);
  });

  it("ruhsat scan fills blanks on a matched bike without overwriting set fields", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);

    // User already has a bike with the plate, but Make/year are blank and
    // model is set to something else they don't want overwritten.
    const created = await request(app)
      .post("/api/bikes")
      .set("Cookie", cookie)
      .send({ nickname: "My Bike", plate: "34 ABC 123", model: "Custom Build" });
    const bikeId = created.body.id;

    __setRunVisionOcrForTests(async () => ({
      rawText: JSON.stringify({
        doc_type: "ruhsat",
        plate: "34 ABC 123",
        make: "Ducati",
        model: "Monster 937",
        year: 2023,
        dates: {},
        confidence: 0.95,
      }),
      model: "test-model",
    }));

    const post = await request(app)
      .post("/api/documents")
      .set("Cookie", cookie)
      .attach("file", await makeJpeg(), { filename: "r.jpg", contentType: "image/jpeg" });
    await waitForDoc(app, cookie, post.body.id);

    const bike = await request(app).get(`/api/bikes/${bikeId}`).set("Cookie", cookie);
    expect(bike.body.make).toBe("Ducati");          // was blank — filled
    expect(bike.body.year).toBe(2023);              // was blank — filled
    expect(bike.body.model).toBe("Custom Build");   // already set — preserved
  });

  it("sigorta scan with no bike yet still records the document (no auto-create)", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);

    __setRunVisionOcrForTests(async () => ({
      rawText: JSON.stringify({
        doc_type: "sigorta",
        plate: "34 ZZZ 999",
        dates: { sigorta_expires_on: "2027-06-01" },
        confidence: 0.95,
      }),
      model: "test-model",
    }));

    const post = await request(app)
      .post("/api/documents")
      .set("Cookie", cookie)
      .attach("file", await makeJpeg(), { filename: "s.jpg", contentType: "image/jpeg" });
    const finished = await waitForDoc(app, cookie, post.body.id);

    // No bike pre-existing, no auto-create for dated docs.
    expect(finished.appliedDatedItemId).toBeNull();
    expect(finished.bikeId).toBeNull();
    const bikes = await request(app).get("/api/bikes").set("Cookie", cookie);
    expect(bikes.body).toHaveLength(0);
  });
});
