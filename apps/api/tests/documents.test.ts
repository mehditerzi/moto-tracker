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
});
