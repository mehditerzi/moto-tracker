import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import fs from "node:fs/promises";
import sharp from "sharp";
import type { Express } from "express";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";
import { createOrg, addMember } from "./helpers/org.js";
import { grantEntitlement } from "./helpers/grantEntitlement.js";
import {
  __setRunVisionOcrForTests,
  __resetRunVisionOcrForTests,
} from "../src/ocr/worker.js";
import { documentLimits } from "../src/routes/documents.js";
import { getDb } from "../src/db/index.js";

/**
 * Bulk capture. The single-document path is covered by documents.test.ts; what
 * is new here is the promise a batch makes — that NOTHING is written until the
 * user says so, that saying so twice still writes it once, and that the garage
 * a batch was aimed at is the only garage it can touch.
 */

async function makeJpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .jpeg()
    .toBuffer();
}

/** A ruhsat the stubbed OCR "reads", confident enough to auto-apply outside a batch. */
function ruhsat(plate: string, make = "Ducati", model = "Monster 937") {
  return JSON.stringify({
    doc_type: "ruhsat",
    plate,
    make,
    model,
    year: 2023,
    dates: { muayene_expires_on: "2027-03-01" },
    confidence: 0.95,
  });
}

async function upload(app: Express, cookie: string, batchId: string, name = "r.jpg") {
  return request(app)
    .post(`/api/documents?batchId=${encodeURIComponent(batchId)}`)
    .set("Cookie", cookie)
    .attach("file", await makeJpeg(), { filename: name, contentType: "image/jpeg" });
}

async function waitForBatch(app: Express, cookie: string, batchId: string, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request(app).get(`/api/documents/batches/${batchId}`).set("Cookie", cookie);
    if (res.status !== 200) throw new Error(`batch fetch failed: ${res.status}`);
    if (res.body.batch.progress.pending === 0) return res.body;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("batch OCR did not finish in time");
}

/** Confirm one document with the values OCR proposed, as the review screen does. */
async function confirm(
  app: Express,
  cookie: string,
  doc: { id: string; ocrExtracted: Record<string, unknown> | null },
  overrides: Record<string, unknown> = {},
) {
  const ex = doc.ocrExtracted ?? {};
  return request(app)
    .patch(`/api/documents/${doc.id}/decision`)
    .set("Cookie", cookie)
    .send({
      state: "confirmed",
      decision: {
        action: "create",
        fields: {
          plate: (ex.plate as string) ?? "",
          make: (ex.make as string) ?? "",
          model: (ex.model as string) ?? "",
          year: ex.year != null ? String(ex.year) : "",
        },
        dates: {},
        ...overrides,
      },
    });
}

describe("/api/documents/batches", () => {
  afterEach(async () => {
    __resetRunVisionOcrForTests();
    documentLimits.perDay = 60;
    documentLimits.perBatch = 25;
    await fs.rm("/tmp/mototracker-test-uploads", { recursive: true, force: true }).catch(() => {});
  });

  it("requires auth", async () => {
    const app = buildTestApp();
    expect((await request(app).post("/api/documents/batches")).status).toBe(401);
    expect((await request(app).get("/api/documents/batches")).status).toBe(401);
  });

  // ── the whole lifecycle, end to end ────────────────────────────────────────

  it("captures three documents, reviews them in one pass and applies once", async () => {
    const app = buildTestApp();
    const { cookie, user } = await signUpAndSignIn(app);
    grantEntitlement(user.id);

    const plates = ["34 ABC 123", "06 DEF 456", "35 GHI 789"];
    let call = 0;
    __setRunVisionOcrForTests(async () => ({
      rawText: ruhsat(plates[call++ % plates.length]!),
      model: "test-model",
    }));

    const batch = await request(app).post("/api/documents/batches").set("Cookie", cookie).send({});
    expect(batch.status).toBe(201);
    expect(batch.body.progress).toEqual({ total: 0, pending: 0, done: 0, failed: 0, decided: 0 });

    for (let i = 0; i < 3; i++) {
      const res = await upload(app, cookie, batch.body.id, `r${i}.jpg`);
      expect(res.status).toBe(201);
      expect(res.body.batchId).toBe(batch.body.id);
      // Capture order is explicit, not inferred from a one-second timestamp.
      expect(res.body.batchSeq).toBe(i);
      expect(res.body.reviewState).toBe("pending");
    }

    const detail = await waitForBatch(app, cookie, batch.body.id);
    expect(detail.batch.progress).toMatchObject({ total: 3, done: 3, failed: 0, decided: 0 });
    expect(detail.documents.map((d: { batchSeq: number }) => d.batchSeq)).toEqual([0, 1, 2]);

    // Nothing exists yet — the point of a batch.
    const before = await request(app).get("/api/bikes").set("Cookie", cookie);
    expect(before.body).toHaveLength(0);
    expect(detail.documents.every((d: { suggestion: string }) => d.suggestion === "create")).toBe(true);

    // One tap per document: confirm what OCR proposed.
    for (const d of detail.documents) {
      const res = await confirm(app, cookie, d, { dates: { muayene: "2027-03-01" } });
      expect(res.status).toBe(200);
      expect(res.body.reviewState).toBe("confirmed");
    }
    const midway = await request(app).get(`/api/documents/batches/${batch.body.id}`).set("Cookie", cookie);
    expect(midway.body.batch.progress.decided).toBe(3);

    const applied = await request(app)
      .post(`/api/documents/batches/${batch.body.id}/apply`)
      .set("Cookie", cookie);
    expect(applied.status).toBe(200);
    expect(applied.body).toMatchObject({ created: 3, updated: 0, datedItems: 3 });

    const bikes = await request(app).get("/api/bikes").set("Cookie", cookie);
    expect(bikes.body).toHaveLength(3);
    expect(bikes.body.map((b: { plate: string }) => b.plate).sort()).toEqual([...plates].sort());

    // Each document now points at the vehicle it produced.
    const after = await request(app).get(`/api/documents/batches/${batch.body.id}`).set("Cookie", cookie);
    expect(after.body.batch.status).toBe("applied");
    expect(after.body.documents.every((d: { bikeId: string | null }) => d.bikeId)).toBe(true);
    expect(after.body.documents.every((d: { reviewState: string }) => d.reviewState === "applied")).toBe(true);
  });

  it("cannot be applied twice", async () => {
    const app = buildTestApp();
    const { cookie, user } = await signUpAndSignIn(app);
    grantEntitlement(user.id);
    __setRunVisionOcrForTests(async () => ({ rawText: ruhsat("34 ABC 123"), model: "m" }));

    const batch = await request(app).post("/api/documents/batches").set("Cookie", cookie).send({});
    await upload(app, cookie, batch.body.id);
    const detail = await waitForBatch(app, cookie, batch.body.id);
    await confirm(app, cookie, detail.documents[0]);

    const first = await request(app)
      .post(`/api/documents/batches/${batch.body.id}/apply`)
      .set("Cookie", cookie);
    expect(first.status).toBe(200);
    expect(first.body.created).toBe(1);

    const second = await request(app)
      .post(`/api/documents/batches/${batch.body.id}/apply`)
      .set("Cookie", cookie);
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("batch_already_applied");

    // And exactly one vehicle exists, not two.
    const bikes = await request(app).get("/api/bikes").set("Cookie", cookie);
    expect(bikes.body).toHaveLength(1);
  });

  it("never auto-applies inside a batch, even at high confidence", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    // The identical stub auto-creates a bike on the single-document path
    // (documents.test.ts). Inside a batch it must only ever suggest.
    __setRunVisionOcrForTests(async () => ({ rawText: ruhsat("34 ABC 123"), model: "m" }));

    const batch = await request(app).post("/api/documents/batches").set("Cookie", cookie).send({});
    await upload(app, cookie, batch.body.id);
    const detail = await waitForBatch(app, cookie, batch.body.id);

    expect(detail.documents[0].ocrStatus).toBe("done");
    expect(detail.documents[0].bikeId).toBeNull();
    expect(detail.documents[0].appliedDatedItemId).toBeNull();
    const bikes = await request(app).get("/api/bikes").set("Cookie", cookie);
    expect(bikes.body).toHaveLength(0);
  });

  // ── partial failure ────────────────────────────────────────────────────────

  it("applies the readable documents when one scan fails, and lets the failure be retried", async () => {
    const app = buildTestApp();
    const { cookie, user } = await signUpAndSignIn(app);
    grantEntitlement(user.id);

    let call = 0;
    __setRunVisionOcrForTests(async () => {
      call += 1;
      if (call === 2) throw new Error("ollama unreachable");
      return { rawText: ruhsat(call === 1 ? "34 ABC 123" : "06 DEF 456"), model: "m" };
    });

    const batch = await request(app).post("/api/documents/batches").set("Cookie", cookie).send({});
    for (let i = 0; i < 3; i++) await upload(app, cookie, batch.body.id, `r${i}.jpg`);
    const detail = await waitForBatch(app, cookie, batch.body.id);

    expect(detail.batch.progress).toMatchObject({ total: 3, done: 2, failed: 1 });
    const failed = detail.documents.find((d: { ocrStatus: string }) => d.ocrStatus === "failed");
    expect(failed).toBeTruthy();

    // A failure does not block the batch: confirm the two that read, skip the one
    // that did not, and the batch still applies.
    for (const d of detail.documents.filter((x: { ocrStatus: string }) => x.ocrStatus === "done")) {
      await confirm(app, cookie, d);
    }
    const skip = await request(app)
      .patch(`/api/documents/${failed.id}/decision`)
      .set("Cookie", cookie)
      .send({ state: "skipped" });
    expect(skip.status).toBe(200);
    expect(skip.body.reviewState).toBe("skipped");

    const applied = await request(app)
      .post(`/api/documents/batches/${batch.body.id}/apply`)
      .set("Cookie", cookie);
    expect(applied.status).toBe(200);
    expect(applied.body.created).toBe(2);
    expect((await request(app).get("/api/bikes").set("Cookie", cookie)).body).toHaveLength(2);
  });

  it("re-queues a failed scan on rescan without spending the daily allowance", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);

    let call = 0;
    __setRunVisionOcrForTests(async () => {
      call += 1;
      if (call === 1) throw new Error("transient");
      return { rawText: ruhsat("34 ABC 123"), model: "m" };
    });

    const batch = await request(app).post("/api/documents/batches").set("Cookie", cookie).send({});
    await upload(app, cookie, batch.body.id);
    const first = await waitForBatch(app, cookie, batch.body.id);
    expect(first.documents[0].ocrStatus).toBe("failed");

    const rescan = await request(app)
      .post(`/api/documents/${first.documents[0].id}/rescan`)
      .set("Cookie", cookie);
    expect(rescan.status).toBe(200);
    expect(rescan.body.ocrStatus).toBe("pending");

    const second = await waitForBatch(app, cookie, batch.body.id);
    expect(second.documents[0].ocrStatus).toBe("done");
    // One image, one document row — a retry is not a new upload.
    expect(second.batch.progress.total).toBe(1);
  });

  // ── isolation ──────────────────────────────────────────────────────────────

  it("is invisible to another user, who can neither read, fill nor apply it", async () => {
    const app = buildTestApp();
    const mine = await signUpAndSignIn(app, "mine@test.com");
    const theirs = await signUpAndSignIn(app, "theirs@test.com");
    __setRunVisionOcrForTests(async () => ({ rawText: ruhsat("34 ABC 123"), model: "m" }));

    const batch = await request(app).post("/api/documents/batches").set("Cookie", mine.cookie).send({});
    await upload(app, mine.cookie, batch.body.id);
    const detail = await waitForBatch(app, mine.cookie, batch.body.id);

    const id = batch.body.id;
    expect((await request(app).get(`/api/documents/batches/${id}`).set("Cookie", theirs.cookie)).status).toBe(404);
    expect((await upload(app, theirs.cookie, id)).status).toBe(404);
    expect((await request(app).post(`/api/documents/batches/${id}/apply`).set("Cookie", theirs.cookie)).status).toBe(404);
    expect((await request(app).delete(`/api/documents/batches/${id}`).set("Cookie", theirs.cookie)).status).toBe(404);
    expect(
      (
        await request(app)
          .patch(`/api/documents/${detail.documents[0].id}/decision`)
          .set("Cookie", theirs.cookie)
          .send({ state: "skipped" })
      ).status,
    ).toBe(404);

    // And the other user's own batch list stays empty.
    const list = await request(app).get("/api/documents/batches").set("Cookie", theirs.cookie);
    expect(list.body).toEqual([]);
  });

  it("lists an unfinished batch so it can be resumed, and forgets an empty one", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    __setRunVisionOcrForTests(async () => ({ rawText: ruhsat("34 ABC 123"), model: "m" }));

    const empty = await request(app).post("/api/documents/batches").set("Cookie", cookie).send({});
    expect((await request(app).get("/api/documents/batches").set("Cookie", cookie)).body).toEqual([]);

    await upload(app, cookie, empty.body.id);
    await waitForBatch(app, cookie, empty.body.id);
    const list = await request(app).get("/api/documents/batches").set("Cookie", cookie);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(empty.body.id);
    expect(list.body[0].progress.total).toBe(1);
  });

  // ── org scoping ────────────────────────────────────────────────────────────

  it("puts an org batch's vehicles in the fleet, never in the uploader's garage", async () => {
    const app = buildTestApp();
    const owner = await signUpAndSignIn(app, "owner@filo.test");
    const orgId = createOrg("Kervan Filo", "fleet", 10);
    addMember(orgId, owner.user.id, "owner");
    __setRunVisionOcrForTests(async () => ({ rawText: ruhsat("34 ORG 111"), model: "m" }));

    const batch = await request(app)
      .post("/api/documents/batches")
      .set("Cookie", owner.cookie)
      .send({ orgId });
    expect(batch.status).toBe(201);
    expect(batch.body.orgId).toBe(orgId);

    await upload(app, owner.cookie, batch.body.id);
    const detail = await waitForBatch(app, owner.cookie, batch.body.id);
    await confirm(app, owner.cookie, detail.documents[0]);
    const applied = await request(app)
      .post(`/api/documents/batches/${batch.body.id}/apply`)
      .set("Cookie", owner.cookie);
    expect(applied.status).toBe(200);

    const bike = getDb()
      .prepare("SELECT org_id, user_id FROM bike WHERE id = ?")
      .get(applied.body.bikeIds[0]) as { org_id: string; user_id: string };
    expect(bike.org_id).toBe(orgId);
    // The owner is the custodian, but the vehicle is the org's — it must not
    // count against their personal garage.
    const personal = getDb()
      .prepare("SELECT COUNT(*) AS n FROM bike WHERE user_id = ? AND org_id IS NULL")
      .get(owner.user.id) as { n: number };
    expect(personal.n).toBe(0);
  });

  it("refuses an org batch to a non-member (404) and to staff (403)", async () => {
    const app = buildTestApp();
    const owner = await signUpAndSignIn(app, "o@filo.test");
    const staff = await signUpAndSignIn(app, "s@filo.test");
    const outsider = await signUpAndSignIn(app, "x@filo.test");
    const orgId = createOrg("Kervan Filo", "fleet", 10);
    addMember(orgId, owner.user.id, "owner");
    addMember(orgId, staff.user.id, "staff");

    const asOutsider = await request(app)
      .post("/api/documents/batches")
      .set("Cookie", outsider.cookie)
      .send({ orgId });
    expect(asOutsider.status).toBe(404);

    const asStaff = await request(app)
      .post("/api/documents/batches")
      .set("Cookie", staff.cookie)
      .send({ orgId });
    expect(asStaff.status).toBe(403);
  });

  it("will not aim a decision at a vehicle outside the batch's garage", async () => {
    const app = buildTestApp();
    const owner = await signUpAndSignIn(app, "owner2@filo.test");
    const orgId = createOrg("Kervan Filo", "fleet", 10);
    addMember(orgId, owner.user.id, "owner");
    // A personal vehicle of the same person, which an org batch must not touch.
    const personal = await request(app)
      .post("/api/bikes")
      .set("Cookie", owner.cookie)
      .send({ nickname: "Kendi motorum", plate: "34 KEN 111" });
    __setRunVisionOcrForTests(async () => ({ rawText: ruhsat("34 ORG 222"), model: "m" }));

    const batch = await request(app)
      .post("/api/documents/batches")
      .set("Cookie", owner.cookie)
      .send({ orgId });
    await upload(app, owner.cookie, batch.body.id);
    const detail = await waitForBatch(app, owner.cookie, batch.body.id);

    const res = await request(app)
      .patch(`/api/documents/${detail.documents[0].id}/decision`)
      .set("Cookie", owner.cookie)
      .send({
        state: "confirmed",
        decision: { action: "update", targetBikeId: personal.body.id, fields: {}, dates: {} },
      });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("bike_not_found");
  });

  it("suggests updating an existing vehicle rather than duplicating its plate", async () => {
    const app = buildTestApp();
    const { cookie, user } = await signUpAndSignIn(app);
    grantEntitlement(user.id);
    const existing = await request(app)
      .post("/api/bikes")
      .set("Cookie", cookie)
      .send({ nickname: "Monster", plate: "34 ABC 123" });
    __setRunVisionOcrForTests(async () => ({ rawText: ruhsat("34ABC123"), model: "m" }));

    const batch = await request(app).post("/api/documents/batches").set("Cookie", cookie).send({});
    await upload(app, cookie, batch.body.id);
    const detail = await waitForBatch(app, cookie, batch.body.id);

    // Spacing differs; it is the same vehicle.
    expect(detail.documents[0].suggestion).toBe("update");
    expect(detail.documents[0].suggestedBikeId).toBe(existing.body.id);

    await request(app)
      .patch(`/api/documents/${detail.documents[0].id}/decision`)
      .set("Cookie", cookie)
      .send({
        state: "confirmed",
        decision: {
          action: "update",
          targetBikeId: existing.body.id,
          fields: { make: "Ducati", year: "2023" },
          dates: { muayene: "2027-03-01" },
        },
      });
    const applied = await request(app)
      .post(`/api/documents/batches/${batch.body.id}/apply`)
      .set("Cookie", cookie);
    expect(applied.body).toMatchObject({ created: 0, updated: 1, datedItems: 1 });
    const bikes = await request(app).get("/api/bikes").set("Cookie", cookie);
    expect(bikes.body).toHaveLength(1);
    expect(bikes.body[0].make).toBe("Ducati");
    expect(bikes.body[0].year).toBe(2023);
  });

  it("folds two shots of the same plate into one vehicle", async () => {
    const app = buildTestApp();
    const { cookie, user } = await signUpAndSignIn(app);
    grantEntitlement(user.id);
    __setRunVisionOcrForTests(async () => ({ rawText: ruhsat("34 ABC 123"), model: "m" }));

    const batch = await request(app).post("/api/documents/batches").set("Cookie", cookie).send({});
    await upload(app, cookie, batch.body.id, "a.jpg");
    await upload(app, cookie, batch.body.id, "b.jpg");
    const detail = await waitForBatch(app, cookie, batch.body.id);
    for (const d of detail.documents) await confirm(app, cookie, d);

    const applied = await request(app)
      .post(`/api/documents/batches/${batch.body.id}/apply`)
      .set("Cookie", cookie);
    expect(applied.body).toMatchObject({ created: 1, merged: 1 });
    expect((await request(app).get("/api/bikes").set("Cookie", cookie)).body).toHaveLength(1);
    // Both documents still resolve to the vehicle, so neither photo is orphaned.
    const after = await request(app).get(`/api/documents/batches/${batch.body.id}`).set("Cookie", cookie);
    const ids = new Set(after.body.documents.map((d: { bikeId: string }) => d.bikeId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBe(applied.body.bikeIds[0]);
  });

  // ── ceilings ───────────────────────────────────────────────────────────────

  it("refuses the whole batch — writing nothing — when it would exceed the vehicle ceiling", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    // No entitlement: the free tier is one vehicle.
    const plates = ["34 AAA 111", "34 BBB 222", "34 CCC 333"];
    let call = 0;
    __setRunVisionOcrForTests(async () => ({ rawText: ruhsat(plates[call++]!), model: "m" }));

    const batch = await request(app).post("/api/documents/batches").set("Cookie", cookie).send({});
    for (let i = 0; i < 3; i++) await upload(app, cookie, batch.body.id, `r${i}.jpg`);
    const detail = await waitForBatch(app, cookie, batch.body.id);
    for (const d of detail.documents) await confirm(app, cookie, d);

    const applied = await request(app)
      .post(`/api/documents/batches/${batch.body.id}/apply`)
      .set("Cookie", cookie);
    expect(applied.status).toBe(403);
    expect(applied.body).toMatchObject({ error: "vehicle_limit_reached", needed: 3, available: 1 });
    // Nothing half-created, and the batch is still open so the user can skip two
    // and apply the one they care about.
    expect((await request(app).get("/api/bikes").set("Cookie", cookie)).body).toHaveLength(0);
    const still = await request(app).get(`/api/documents/batches/${batch.body.id}`).set("Cookie", cookie);
    expect(still.body.batch.status).toBe("open");
  });

  it("enforces the daily upload allowance and the per-batch size", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    __setRunVisionOcrForTests(async () => ({ rawText: ruhsat("34 ABC 123"), model: "m" }));

    documentLimits.perBatch = 2;
    const batch = await request(app).post("/api/documents/batches").set("Cookie", cookie).send({});
    expect((await upload(app, cookie, batch.body.id, "1.jpg")).status).toBe(201);
    expect((await upload(app, cookie, batch.body.id, "2.jpg")).status).toBe(201);
    const third = await upload(app, cookie, batch.body.id, "3.jpg");
    // Named and actionable — "this pile is full", not a silent 429.
    expect(third.status).toBe(409);
    expect(third.body).toMatchObject({ error: "batch_full", limit: 2 });

    // The day allowance is separate, and is deliberately silent.
    documentLimits.perDay = 2;
    const next = await request(app).post("/api/documents/batches").set("Cookie", cookie).send({});
    const capped = await upload(app, cookie, next.body.id, "4.jpg");
    expect(capped.status).toBe(429);
    expect(capped.body.error).toBe("service_unavailable");
  });

  // ── discarding ─────────────────────────────────────────────────────────────

  it("discards a batch with its images, and refuses to discard an applied one", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    __setRunVisionOcrForTests(async () => ({ rawText: ruhsat("34 ABC 123"), model: "m" }));

    const batch = await request(app).post("/api/documents/batches").set("Cookie", cookie).send({});
    await upload(app, cookie, batch.body.id);
    const detail = await waitForBatch(app, cookie, batch.body.id);
    const filePath = getDb()
      .prepare("SELECT file_path FROM document WHERE id = ?")
      .get(detail.documents[0].id) as { file_path: string };
    await expect(fs.stat(filePath.file_path)).resolves.toBeTruthy();

    const del = await request(app).delete(`/api/documents/batches/${batch.body.id}`).set("Cookie", cookie);
    expect(del.status).toBe(204);
    await expect(fs.stat(filePath.file_path)).rejects.toThrow();
    expect(
      (await request(app).get(`/api/documents/${detail.documents[0].id}`).set("Cookie", cookie)).status,
    ).toBe(404);

    // Uploading into a closed batch is refused rather than silently orphaned.
    expect((await upload(app, cookie, batch.body.id)).status).toBe(409);
  });
});
