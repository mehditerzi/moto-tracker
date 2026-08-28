import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { buildTestApp } from "./helpers/buildApp.js";
import { getDb } from "../src/db/index.js";
import { newId } from "../src/lib/ulid.js";
import { config } from "../src/config.js";
import {
  enqueueDocument,
  queueDepth,
  __setRunVisionOcrForTests,
  __resetRunVisionOcrForTests,
} from "../src/ocr/worker.js";

/**
 * The OCR queue, exercised directly.
 *
 * Bulk capture is the reason this matters: before batches, "twenty documents at
 * once" was not a thing a user could do, so the queue only had to avoid
 * thrashing Tesseract. Now one person can put twenty jobs in front of everyone
 * else, and the three properties tested here are what stop that from being felt
 * by anyone but them.
 */

/** A document row with no real file — the pipeline is stubbed, nothing reads it. */
function insertDoc(userId: string, batchId: string | null = null): string {
  const id = newId();
  getDb()
    .prepare(
      `INSERT INTO document (id, user_id, bike_id, file_path, mime_type, size_bytes, ocr_status, batch_id)
       VALUES (?, ?, NULL, ?, 'image/jpeg', 10, 'pending', ?)`,
    )
    .run(id, userId, `/tmp/does-not-exist-${id}.jpg`, batchId);
  return id;
}

function insertBatch(userId: string): string {
  const id = newId();
  getDb().prepare("INSERT INTO document_batch (id, user_id) VALUES (?, ?)").run(id, userId);
  return id;
}

function insertUser(email: string): string {
  const id = newId();
  getDb()
    .prepare("INSERT INTO user (id, email, name, emailVerified) VALUES (?, ?, ?, 0)")
    .run(id, email, email);
  return id;
}

describe("ocr scheduler", () => {
  let originalConcurrency: number;

  beforeEach(() => {
    buildTestApp();
    originalConcurrency = config.OCR_CONCURRENCY;
  });

  afterEach(() => {
    __resetRunVisionOcrForTests();
    (config as { OCR_CONCURRENCY: number }).OCR_CONCURRENCY = originalConcurrency;
  });

  it("runs one user's documents one at a time, in the order they were shot", async () => {
    (config as { OCR_CONCURRENCY: number }).OCR_CONCURRENCY = 4;
    const user = insertUser("serial@test.com");
    const order: string[] = [];
    let concurrent = 0;
    let peak = 0;

    __setRunVisionOcrForTests(async (filePath) => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      order.push(filePath);
      await new Promise((r) => setTimeout(r, 5));
      concurrent -= 1;
      return { rawText: '{"doc_type":"unknown","dates":{},"confidence":0}', model: "m" };
    });

    const ids = [insertDoc(user), insertDoc(user), insertDoc(user)];
    await Promise.all(ids.map((id) => enqueueDocument(id, user)));

    // Never two at once for one user, even with four slots free…
    expect(peak).toBe(1);
    // …and in capture order, which is what makes "3 of 17" mean anything.
    expect(order.map((p) => p.split("-").pop())).toEqual(ids.map((id) => `${id}.jpg`.split("-").pop()));
  });

  it("gives a waiting user the next free slot instead of draining one batch first", async () => {
    // One slot, so the ordering is fully determined by the scheduler.
    (config as { OCR_CONCURRENCY: number }).OCR_CONCURRENCY = 1;
    const a = insertUser("batcher@test.com");
    const b = insertUser("bystander@test.com");
    const seen: string[] = [];
    const label = new Map<string, string>();

    __setRunVisionOcrForTests(async (filePath) => {
      seen.push(label.get(filePath)!);
      return { rawText: '{"doc_type":"unknown","dates":{},"confidence":0}', model: "m" };
    });

    const batchA = insertBatch(a);
    const batchB = insertBatch(b);
    const a1 = insertDoc(a, batchA);
    const a2 = insertDoc(a, batchA);
    const a3 = insertDoc(a, batchA);
    const b1 = insertDoc(b, batchB);
    for (const [id, name] of [
      [a1, "a1"],
      [a2, "a2"],
      [a3, "a3"],
      [b1, "b1"],
    ] as const) {
      label.set(`/tmp/does-not-exist-${id}.jpg`, name);
    }

    const pending = [
      enqueueDocument(a1, a, { priority: "bulk" }),
      enqueueDocument(a2, a, { priority: "bulk" }),
      enqueueDocument(a3, a, { priority: "bulk" }),
      enqueueDocument(b1, b, { priority: "bulk" }),
    ];
    // Queued before anything ran: the ring has both users to be fair between.
    expect(queueDepth(a)).toBe(3);
    await Promise.all(pending);

    // Round-robin: B's single document does NOT wait behind A's whole batch.
    expect(seen).toEqual(["a1", "b1", "a2", "a3"]);
  });

  it("lets a lone interactive scan jump a queued batch", async () => {
    (config as { OCR_CONCURRENCY: number }).OCR_CONCURRENCY = 1;
    const a = insertUser("bulk@test.com");
    const b = insertUser("watching@test.com");
    const seen: string[] = [];
    const label = new Map<string, string>();

    __setRunVisionOcrForTests(async (filePath) => {
      seen.push(label.get(filePath)!);
      return { rawText: '{"doc_type":"unknown","dates":{},"confidence":0}', model: "m" };
    });

    const batchA = insertBatch(a);
    const bulk = [insertDoc(a, batchA), insertDoc(a, batchA), insertDoc(a, batchA)];
    const solo = insertDoc(b);
    bulk.forEach((id, i) => label.set(`/tmp/does-not-exist-${id}.jpg`, `bulk${i}`));
    label.set(`/tmp/does-not-exist-${solo}.jpg`, "solo");

    await Promise.all([
      ...bulk.map((id) => enqueueDocument(id, a, { priority: "bulk" })),
      enqueueDocument(solo, b, { priority: "interactive" }),
    ]);

    // Somebody is watching a spinner for `solo`; nobody is watching the batch.
    expect(seen[0]).toBe("solo");
  });

  it("does not let a hung document stall the queue behind it", async () => {
    (config as { OCR_CONCURRENCY: number }).OCR_CONCURRENCY = 1;
    const original = config.OCR_TIMEOUT_MS;
    (config as { OCR_TIMEOUT_MS: number }).OCR_TIMEOUT_MS = 50;
    const user = insertUser("hung@test.com");
    let call = 0;
    __setRunVisionOcrForTests(() => {
      call += 1;
      if (call === 1) return new Promise(() => {});
      return Promise.resolve({
        rawText: '{"doc_type":"unknown","dates":{},"confidence":0}',
        model: "m",
      });
    });

    try {
      const first = insertDoc(user);
      const second = insertDoc(user);
      await Promise.all([enqueueDocument(first, user), enqueueDocument(second, user)]);
      const rows = getDb()
        .prepare("SELECT id, ocr_status FROM document WHERE id IN (?, ?)")
        .all(first, second) as { id: string; ocr_status: string }[];
      expect(rows.find((r) => r.id === first)!.ocr_status).toBe("failed");
      expect(rows.find((r) => r.id === second)!.ocr_status).toBe("done");
    } finally {
      (config as { OCR_TIMEOUT_MS: number }).OCR_TIMEOUT_MS = original;
    }
  });
});
