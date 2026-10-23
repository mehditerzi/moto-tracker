import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";
import { grantEntitlement } from "./helpers/grantEntitlement.js";
import { proLimits } from "../src/lib/entitlement.js";
import { getDb } from "../src/db/index.js";
import { FREE_ATTACHMENT_LIMIT, FREE_SCANS_PER_MONTH } from "@mototracker/shared";

type App = ReturnType<typeof buildTestApp>;

async function makeBike(app: App, cookie: string, nickname = "B") {
  const res = await request(app).post("/api/bikes").set("Cookie", cookie).send({ nickname });
  return res.body.id as string;
}

function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 30, channels: 3, background: "#c33" } })
    .jpeg()
    .toBuffer();
}

afterEach(() => {
  proLimits.enforced = false;
});

describe("/api/expenses", () => {
  it("requires auth", async () => {
    const app = buildTestApp();
    expect((await request(app).get("/api/expenses?bikeId=x")).status).toBe(401);
  });

  it("create, list, update, delete", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bikeId = await makeBike(app, cookie);

    const created = await request(app)
      .post("/api/expenses")
      .set("Cookie", cookie)
      .send({ bikeId, category: "parking", amount: 120, spentOn: "2026-10-01", vendor: "İSPARK" });
    expect(created.status).toBe(201);
    expect(created.body.category).toBe("parking");

    const list = await request(app).get(`/api/expenses?bikeId=${bikeId}`).set("Cookie", cookie);
    expect(list.body).toHaveLength(1);

    const patched = await request(app)
      .patch(`/api/expenses/${created.body.id}`)
      .set("Cookie", cookie)
      .send({ amount: 150 });
    expect(patched.body.amount).toBe(150);
    expect(patched.body.vendor).toBe("İSPARK");

    expect((await request(app).delete(`/api/expenses/${created.body.id}`).set("Cookie", cookie)).status).toBe(204);
    expect((await request(app).get(`/api/expenses?bikeId=${bikeId}`).set("Cookie", cookie)).body).toHaveLength(0);
  });

  it("moves the odometer forward, never back", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bikeId = await makeBike(app, cookie);
    const send = (km: number) =>
      request(app)
        .post("/api/expenses")
        .set("Cookie", cookie)
        .send({ bikeId, category: "wash", amount: 100, spentOn: "2026-10-01", odometerKm: km });
    await send(5000);
    await send(4000);
    const bike = getDb().prepare("SELECT current_km FROM bike WHERE id = ?").get(bikeId) as { current_km: number };
    expect(bike.current_km).toBe(5000);
  });

  it("refuses somebody else's vehicle and somebody else's expense", async () => {
    const app = buildTestApp();
    const a = await signUpAndSignIn(app);
    const b = await signUpAndSignIn(app);
    const bikeId = await makeBike(app, a.cookie);
    const exp = await request(app)
      .post("/api/expenses")
      .set("Cookie", a.cookie)
      .send({ bikeId, category: "toll", amount: 50, spentOn: "2026-10-01" });

    expect(
      (
        await request(app)
          .post("/api/expenses")
          .set("Cookie", b.cookie)
          .send({ bikeId, category: "toll", amount: 1, spentOn: "2026-10-01" })
      ).status,
    ).toBe(404);
    expect((await request(app).get(`/api/expenses?bikeId=${bikeId}`).set("Cookie", b.cookie)).status).toBe(404);
    expect(
      (await request(app).patch(`/api/expenses/${exp.body.id}`).set("Cookie", b.cookie).send({ amount: 0 })).status,
    ).toBe(404);
    await request(app).delete(`/api/expenses/${exp.body.id}`).set("Cookie", b.cookie);
    expect((await request(app).get(`/api/expenses?bikeId=${bikeId}`).set("Cookie", a.cookie)).body).toHaveLength(1);
  });

  it("summary adds fuel, policies, maintenance and expenses, with cost per km", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bikeId = await makeBike(app, cookie);
    const today = new Date().toISOString().slice(0, 10);

    await request(app)
      .post("/api/fuel-logs")
      .set("Cookie", cookie)
      .send({ bikeId, filledOn: today, liters: 30, totalCost: 1000, odometerKm: 10_000 });
    await request(app)
      .post("/api/fuel-logs")
      .set("Cookie", cookie)
      .send({ bikeId, filledOn: today, liters: 30, totalCost: 1000, odometerKm: 11_000 });
    await request(app)
      .post("/api/expenses")
      .set("Cookie", cookie)
      .send({ bikeId, category: "repair", amount: 500, spentOn: today });
    await request(app)
      .post(`/api/bikes/${bikeId}/dated-items`)
      .set("Cookie", cookie)
      .send({ type: "sigorta", expiresOn: "2027-10-01", cost: 2500 });

    const res = await request(app).get(`/api/expenses/summary?bikeId=${bikeId}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.bySource).toEqual({ fuel: 2000, maintenance: 0, document: 2500, expense: 500 });
    expect(res.body.total).toBe(5000);
    expect(res.body.byCategory).toEqual({ repair: 500 });
    expect(res.body.distanceKm).toBe(1000);
    expect(res.body.costPerKm).toBe(5);
    expect(res.body.months).toHaveLength(12);
    expect(res.body.months.at(-1).total).toBe(5000);
  });

  it("csv export is Pro once the free allowances are enforced", async () => {
    const app = buildTestApp();
    const { cookie, user } = await signUpAndSignIn(app);
    const bikeId = await makeBike(app, cookie);
    await request(app)
      .post("/api/expenses")
      .set("Cookie", cookie)
      .send({ bikeId, category: "parking", amount: 75.5, spentOn: "2026-10-01", vendor: "Otopark, Kadıköy" });

    const open = await request(app).get(`/api/expenses/export.csv?bikeId=${bikeId}`).set("Cookie", cookie);
    expect(open.status).toBe(200);
    expect(open.text.charCodeAt(0)).toBe(0xfeff);
    expect(open.text).toContain('"Otopark, Kadıköy",75.50');

    proLimits.enforced = true;
    const gated = await request(app).get(`/api/expenses/export.csv?bikeId=${bikeId}`).set("Cookie", cookie);
    expect(gated.status).toBe(402);
    expect(gated.body.error).toBe("pro_required");

    grantEntitlement(user.id, "com.mehditerzi.mototracker.pro.yearly", 100);
    expect((await request(app).get(`/api/expenses/export.csv?bikeId=${bikeId}`).set("Cookie", cookie)).status).toBe(200);
  });
});

describe("/api/mechanics", () => {
  it("CRUD, favourites first, per-user", async () => {
    const app = buildTestApp();
    const a = await signUpAndSignIn(app);
    const b = await signUpAndSignIn(app);
    await request(app).post("/api/mechanics").set("Cookie", a.cookie).send({ name: "Zeki Usta", phone: "0532 123 45 67" });
    const fav = await request(app)
      .post("/api/mechanics")
      .set("Cookie", a.cookie)
      .send({ name: "Ahmet Lastik", specialty: "tires", favorite: true });
    expect(fav.status).toBe(201);

    const list = await request(app).get("/api/mechanics").set("Cookie", a.cookie);
    expect(list.body.map((m: { name: string }) => m.name)).toEqual(["Ahmet Lastik", "Zeki Usta"]);
    expect((await request(app).get("/api/mechanics").set("Cookie", b.cookie)).body).toHaveLength(0);

    expect(
      (await request(app).patch(`/api/mechanics/${fav.body.id}`).set("Cookie", b.cookie).send({ name: "x" })).status,
    ).toBe(404);
    const upd = await request(app)
      .patch(`/api/mechanics/${fav.body.id}`)
      .set("Cookie", a.cookie)
      .send({ favorite: false, phone: "+90 (212) 555 00 00" });
    expect(upd.body.favorite).toBe(false);
    expect(upd.body.specialty).toBe("tires");

    await request(app).delete(`/api/mechanics/${fav.body.id}`).set("Cookie", a.cookie);
    expect((await request(app).get("/api/mechanics").set("Cookie", a.cookie)).body).toHaveLength(1);
  });

  it("rejects a phone number that is not one", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app).post("/api/mechanics").set("Cookie", cookie).send({ name: "X", phone: "call me" });
    expect(res.status).toBe(400);
  });
});

describe("/api/sos-contacts", () => {
  it("add, list, cap, delete", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    for (let i = 0; i < 5; i++) {
      const r = await request(app).post("/api/sos-contacts").set("Cookie", cookie).send({ name: `K${i}`, phone: "05321234567" });
      expect(r.status).toBe(201);
    }
    const sixth = await request(app).post("/api/sos-contacts").set("Cookie", cookie).send({ name: "K6", phone: "05321234567" });
    expect(sixth.status).toBe(409);
    const list = await request(app).get("/api/sos-contacts").set("Cookie", cookie);
    expect(list.body).toHaveLength(5);
    await request(app).delete(`/api/sos-contacts/${list.body[0].id}`).set("Cookie", cookie);
    expect((await request(app).get("/api/sos-contacts").set("Cookie", cookie)).body).toHaveLength(4);
  });
});

describe("/api/attachments", () => {
  it("uploads an image, strips it to a colour JPEG, serves it only to its owner", async () => {
    const app = buildTestApp();
    const a = await signUpAndSignIn(app);
    const b = await signUpAndSignIn(app);
    const bikeId = await makeBike(app, a.cookie);
    const up = await request(app)
      .post("/api/attachments")
      .set("Cookie", a.cookie)
      .field("title", "Ruhsat")
      .field("kind", "registration")
      .field("bikeId", bikeId)
      .attach("file", await jpeg(), { filename: "r.jpg", contentType: "image/jpeg" });
    expect(up.status).toBe(201);
    expect(up.body.mimeType).toBe("image/jpeg");

    const file = await request(app).get(`/api/attachments/${up.body.id}/file`).set("Cookie", a.cookie);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("image/jpeg");
    expect((await request(app).get(`/api/attachments/${up.body.id}/file`).set("Cookie", b.cookie)).status).toBe(404);

    // Filed against the car, plus personal (no-car) files.
    await request(app)
      .post("/api/attachments")
      .set("Cookie", a.cookie)
      .field("title", "Ehliyet")
      .field("kind", "license")
      .attach("file", await jpeg(), { filename: "e.jpg", contentType: "image/jpeg" });
    const list = await request(app).get(`/api/attachments?bikeId=${bikeId}`).set("Cookie", a.cookie);
    expect(list.body).toHaveLength(2);

    const patched = await request(app)
      .patch(`/api/attachments/${up.body.id}`)
      .set("Cookie", a.cookie)
      .send({ title: "Araç ruhsatı" });
    expect(patched.body.title).toBe("Araç ruhsatı");

    await request(app).delete(`/api/attachments/${up.body.id}`).set("Cookie", a.cookie);
    expect((await request(app).get("/api/attachments").set("Cookie", a.cookie)).body).toHaveLength(1);
  });

  it("refuses a 'PDF' that is not one, and a vehicle you cannot attach to", async () => {
    const app = buildTestApp();
    const a = await signUpAndSignIn(app);
    const b = await signUpAndSignIn(app);
    const fake = await request(app)
      .post("/api/attachments")
      .set("Cookie", a.cookie)
      .field("title", "x")
      .attach("file", Buffer.from("not a pdf at all"), { filename: "x.pdf", contentType: "application/pdf" });
    expect(fake.status).toBe(415);

    const real = await request(app)
      .post("/api/attachments")
      .set("Cookie", a.cookie)
      .field("title", "Fatura")
      .field("kind", "invoice")
      .attach("file", Buffer.from("%PDF-1.4\n%%EOF\n"), { filename: "f.pdf", contentType: "application/pdf" });
    expect(real.status).toBe(201);
    expect(real.body.mimeType).toBe("application/pdf");

    const bikeId = await makeBike(app, b.cookie);
    const foreign = await request(app)
      .post("/api/attachments")
      .set("Cookie", a.cookie)
      .field("title", "x")
      .field("bikeId", bikeId)
      .attach("file", await jpeg(), { filename: "r.jpg", contentType: "image/jpeg" });
    expect(foreign.status).toBe(404);
  });

  it("free accounts keep a few files once enforced; Pro keeps them all", async () => {
    const app = buildTestApp();
    const { cookie, user } = await signUpAndSignIn(app);
    proLimits.enforced = true;
    const send = async () =>
      request(app)
        .post("/api/attachments")
        .set("Cookie", cookie)
        .field("title", "f")
        .attach("file", await jpeg(), { filename: "r.jpg", contentType: "image/jpeg" });
    for (let i = 0; i < FREE_ATTACHMENT_LIMIT; i++) expect((await send()).status).toBe(201);
    const over = await send();
    expect(over.status).toBe(402);
    expect(over.body.error).toBe("attachment_limit_reached");

    grantEntitlement(user.id, "com.mehditerzi.mototracker.pro.monthly", 100);
    expect((await send()).status).toBe(201);
  });
});

describe("Garajım Pro entitlement", () => {
  it("free summary reports allowances only when enforced", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    let res = await request(app).get("/api/entitlement").set("Cookie", cookie);
    expect(res.body.pro).toBe(false);
    expect(res.body.scanLimit).toBeNull();
    expect(res.body.scansUsed).toBe(0);

    proLimits.enforced = true;
    res = await request(app).get("/api/entitlement").set("Cookie", cookie);
    expect(res.body.scanLimit).toBe(FREE_SCANS_PER_MONTH);
    expect(res.body.attachmentLimit).toBe(FREE_ATTACHMENT_LIMIT);
  });

  it("a Pro subscription unlocks the garage and lifts the allowances", async () => {
    const app = buildTestApp();
    const { cookie, user } = await signUpAndSignIn(app);
    proLimits.enforced = true;
    grantEntitlement(user.id, "com.mehditerzi.mototracker.pro.yearly", 1);
    const res = await request(app).get("/api/entitlement").set("Cookie", cookie);
    expect(res.body.pro).toBe(true);
    // The catalogue, not the stored row, decides the ceiling.
    expect(res.body.maxVehicles).toBe(100);
    expect(res.body.scanLimit).toBeNull();
    expect(res.body.attachmentLimit).toBeNull();
    expect((await request(app).post("/api/bikes").set("Cookie", cookie).send({ nickname: "1" })).status).toBe(201);
    expect((await request(app).post("/api/bikes").set("Cookie", cookie).send({ nickname: "2" })).status).toBe(201);
  });

  it("the monthly scan allowance answers with a named 402", async () => {
    const app = buildTestApp();
    const { cookie, user } = await signUpAndSignIn(app);
    proLimits.enforced = true;
    const db = getDb();
    const insert = db.prepare(
      "INSERT INTO document (id, user_id, file_path, mime_type, size_bytes, ocr_status) VALUES (?, ?, '/dev/null', 'image/jpeg', 1, 'done')",
    );
    for (let i = 0; i < FREE_SCANS_PER_MONTH; i++) insert.run(`d${i}_${user.id}`, user.id);
    const res = await request(app)
      .post("/api/documents")
      .set("Cookie", cookie)
      .attach("file", await jpeg(), { filename: "s.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(402);
    expect(res.body).toEqual({ error: "scan_limit_reached", limit: FREE_SCANS_PER_MONTH });
  });
});
