import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";
import { grantEntitlement } from "./helpers/grantEntitlement.js";
import {
  foldIdentity,
  normalizeChassis,
  normalizeEngineNo,
  normalizeIdentifier,
} from "../src/lib/vehicleIdentity.js";

/**
 * Identity: which key decides that two records are the same vehicle, and how it
 * survives OCR.
 */

const VIN = "WVWZZZ1JZ3W386752";

describe("identity normalisation", () => {
  it("folds Turkish letters and strips the separators a human types", () => {
    expect(normalizeIdentifier(" wvw-zzz.1jz/3w3 86752 ")).toBe("WVWZZZ1JZ3W386752");
    expect(normalizeIdentifier("şığ")).toBe("SIG");
  });

  it("CORRECTS the three characters a VIN can never contain", () => {
    // I, O and Q are excluded by the VIN standard, so their presence is proof of
    // an OCR error and the intended character is known. This is a repair, not a
    // guess — which is why it produces a value fit to store.
    expect(normalizeChassis("WVWZZZ1JZ3W386752")).toBe("WVWZZZ1JZ3W386752");
    expect(normalizeChassis("WVWZZZ1JZ3W3867S2")).toBe("WVWZZZ1JZ3W3867S2"); // S is legal, kept
    expect(normalizeChassis("WVWZZZIJZ3W386752")).toBe("WVWZZZ1JZ3W386752"); // I → 1
    expect(normalizeChassis("WVWZZZ1JZ3WO86752")).toBe("WVWZZZ1JZ3W086752"); // O → 0
    expect(normalizeChassis("WVWZZZ1JZ3WQ86752")).toBe("WVWZZZ1JZ3W086752"); // Q → 0
  });

  it("refuses anything that is not VIN-shaped, rather than half-claiming it", () => {
    // A partial chassis number is extremely common — a user types four
    // characters and stops. It must neither claim an identity nor block one.
    expect(normalizeChassis("WVWZZZ")).toBeNull();
    expect(normalizeChassis("WVWZZZ1JZ3W3867521")).toBeNull(); // 18
    expect(normalizeChassis(null)).toBeNull();
    expect(normalizeChassis("")).toBeNull();
  });

  it("folds the four OCR confusions onto one match key", () => {
    // The whole point: a chassis read once by a camera and once by a human must
    // land on the same key.
    expect(foldIdentity("WVWZZZ1JZ3W386752")).toBe(foldIdentity("WVWZZZIJZ3W386752"));
    expect(foldIdentity("5B")).toBe(foldIdentity("SB"));
    expect(foldIdentity("58")).toBe(foldIdentity("SB"));
  });

  it("never folds one digit into another, so two real serials cannot collide", () => {
    // The discriminating part of a VIN is its all-numeric serial. If digits
    // folded together, two cars off the same production line would read as one.
    expect(foldIdentity("00000000")).not.toBe(foldIdentity("00000001"));
    expect(foldIdentity("12345678")).not.toBe(foldIdentity("12345679"));
    expect(foldIdentity("11111111")).not.toBe(foldIdentity("21111111"));
  });

  it("will not treat a short engine number as an identity", () => {
    expect(normalizeEngineNo("AB12")).toBeNull();
    expect(normalizeEngineNo("CFNA123456")).toBe("CFNA123456");
  });
});

describe("duplicate detection on POST /api/bikes", () => {
  it("refuses a second record of the same chassis, across accounts", async () => {
    const app = buildTestApp();
    const a = await signUpAndSignIn(app);
    const b = await signUpAndSignIn(app);

    const first = await request(app)
      .post("/api/bikes")
      .set("Cookie", a.cookie)
      .send({ nickname: "Golf", chassisNo: VIN });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/bikes")
      .set("Cookie", b.cookie)
      .send({ nickname: "Aynı araç", chassisNo: VIN });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("vehicle_already_registered");
  });

  it("catches the same vehicle through an OCR misread of its chassis", async () => {
    const app = buildTestApp();
    const a = await signUpAndSignIn(app);
    const b = await signUpAndSignIn(app);
    await request(app)
      .post("/api/bikes")
      .set("Cookie", a.cookie)
      .send({ nickname: "Golf", chassisNo: VIN });

    // O for 0 and I for 1 — precisely what a camera does to a stamped VIN.
    const misread = await request(app)
      .post("/api/bikes")
      .set("Cookie", b.cookie)
      .send({ nickname: "Golf", chassisNo: "WVWZZZIJZ3W386752" });
    expect(misread.status).toBe(409);
    expect(misread.body.matchedOn).toBe("chassis");
  });

  it("REVEALS NOTHING about the vehicle or its holder", async () => {
    const app = buildTestApp();
    const a = await signUpAndSignIn(app);
    const b = await signUpAndSignIn(app);
    const created = await request(app)
      .post("/api/bikes")
      .set("Cookie", a.cookie)
      .send({ nickname: "Gizli", plate: "34ABC123", chassisNo: VIN });

    const dup = await request(app)
      .post("/api/bikes")
      .set("Cookie", b.cookie)
      .send({ nickname: "x", chassisNo: VIN });

    expect(dup.status).toBe(409);
    // Exactly three keys, and not one of them names anything.
    expect(Object.keys(dup.body).sort()).toEqual(["claimToken", "error", "matchedOn"]);
    const blob = JSON.stringify(dup.body);
    expect(blob).not.toContain(created.body.id);
    expect(blob).not.toContain(a.user.id);
    expect(blob).not.toContain(a.user.email);
    expect(blob).not.toContain("Gizli");
    expect(blob).not.toContain("34ABC123");
  });

  it("treats an ENGINE match as evidence, and says which key matched", async () => {
    const app = buildTestApp();
    const a = await signUpAndSignIn(app);
    const b = await signUpAndSignIn(app);
    await request(app)
      .post("/api/bikes")
      .set("Cookie", a.cookie)
      .send({ nickname: "Bandit", engineNo: "J721E1234567" });

    const dup = await request(app)
      .post("/api/bikes")
      .set("Cookie", b.cookie)
      .send({ nickname: "Bandit", engineNo: "J721E1234567" });
    expect(dup.status).toBe(409);
    expect(dup.body.matchedOn).toBe("engine");
  });

  it("NEVER blocks on a plate, because Turkish plates are re-issued", async () => {
    // Two different cars legitimately hold the same plate at different times —
    // and a plate is the one identifier a stranger can read off a bumper, so
    // answering "already tracked" for one would be a plate-to-user oracle.
    const app = buildTestApp();
    const a = await signUpAndSignIn(app);
    const b = await signUpAndSignIn(app);
    await request(app)
      .post("/api/bikes")
      .set("Cookie", a.cookie)
      .send({ nickname: "Eski", plate: "34ABC123" });

    const same = await request(app)
      .post("/api/bikes")
      .set("Cookie", b.cookie)
      .send({ nickname: "Yeni", plate: "34ABC123" });
    expect(same.status).toBe(201);
  });

  it("tells you plainly when the duplicate is already in YOUR OWN garage", async () => {
    // There is nobody to ask, so there is no claim flow and no opaque token —
    // just the id of the record they already have.
    const app = buildTestApp();
    const a = await signUpAndSignIn(app);
    grantEntitlement(a.user.id);
    const first = await request(app)
      .post("/api/bikes")
      .set("Cookie", a.cookie)
      .send({ nickname: "Golf", chassisNo: VIN });

    const again = await request(app)
      .post("/api/bikes")
      .set("Cookie", a.cookie)
      .send({ nickname: "Golf tekrar", chassisNo: VIN });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("vehicle_already_in_garage");
    expect(again.body.bikeId).toBe(first.body.id);
    expect(again.body.claimToken).toBeUndefined();
  });

  it("checks the CEILING before the registry, so a capped user gets no lookup", async () => {
    // Otherwise a free account with its one vehicle already used could still
    // probe VINs all day: the add would fail either way, but the ERROR would
    // tell them whether the vehicle exists.
    const app = buildTestApp();
    const a = await signUpAndSignIn(app);
    const b = await signUpAndSignIn(app);
    await request(app)
      .post("/api/bikes")
      .set("Cookie", a.cookie)
      .send({ nickname: "Golf", chassisNo: VIN });
    // b spends their single free slot on something else.
    await request(app).post("/api/bikes").set("Cookie", b.cookie).send({ nickname: "Benimki" });

    const probe = await request(app)
      .post("/api/bikes")
      .set("Cookie", b.cookie)
      .send({ nickname: "x", chassisNo: VIN });
    expect(probe.status).toBe(403);
    expect(probe.body.error).toBe("vehicle_limit_reached");
    expect(probe.body.claimToken).toBeUndefined();
  });

  it("closes the PATCH door too — an identity cannot be edited onto a decoy", async () => {
    // Without this, the whole uniqueness rule is one edit away from being off:
    // add a blank vehicle, then patch somebody else's VIN onto it.
    const app = buildTestApp();
    const a = await signUpAndSignIn(app);
    const b = await signUpAndSignIn(app);
    await request(app)
      .post("/api/bikes")
      .set("Cookie", a.cookie)
      .send({ nickname: "Golf", chassisNo: VIN });
    const decoy = await request(app)
      .post("/api/bikes")
      .set("Cookie", b.cookie)
      .send({ nickname: "Boş" });

    const steal = await request(app)
      .patch(`/api/bikes/${decoy.body.id}`)
      .set("Cookie", b.cookie)
      .send({ chassisNo: VIN });
    expect(steal.status).toBe(409);
    expect(steal.body.error).toBe("vehicle_already_registered");

    const after = await request(app).get(`/api/bikes/${decoy.body.id}`).set("Cookie", b.cookie);
    expect(after.body.chassisNo).toBeNull();
  });

  it("does not release an identity when its owner blanks the field", async () => {
    // A registry entry is only ever added or replaced. If clearing the chassis
    // released the VIN, uniqueness would last exactly until somebody edited.
    const app = buildTestApp();
    const a = await signUpAndSignIn(app);
    const b = await signUpAndSignIn(app);
    const mine = await request(app)
      .post("/api/bikes")
      .set("Cookie", a.cookie)
      .send({ nickname: "Golf", chassisNo: VIN });
    await request(app)
      .patch(`/api/bikes/${mine.body.id}`)
      .set("Cookie", a.cookie)
      .send({ chassisNo: null });

    const grab = await request(app)
      .post("/api/bikes")
      .set("Cookie", b.cookie)
      .send({ nickname: "Kapkaç", chassisNo: VIN });
    expect(grab.status).toBe(409);
  });

  it("lets a vehicle keep its own identity through an unrelated edit", async () => {
    const app = buildTestApp();
    const a = await signUpAndSignIn(app);
    const mine = await request(app)
      .post("/api/bikes")
      .set("Cookie", a.cookie)
      .send({ nickname: "Golf", chassisNo: VIN });
    const patched = await request(app)
      .patch(`/api/bikes/${mine.body.id}`)
      .set("Cookie", a.cookie)
      .send({ chassisNo: VIN, nickname: "Golf GTI" });
    expect(patched.status).toBe(200);
    expect(patched.body.nickname).toBe("Golf GTI");
  });
});
