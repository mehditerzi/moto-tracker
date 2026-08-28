import { describe, it, expect } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn, type AuthedClient } from "./helpers/authedRequest.js";
import { grantEntitlement } from "./helpers/grantEntitlement.js";
import { getDb } from "../src/db/index.js";

/**
 * The duplicate conversation and ownership handover.
 *
 * The two questions this file exists to answer adversarially: can a claim take a
 * stranger's vehicle, and can a handover move anything it must not?
 */

const VIN = "WVWZZZ1JZ3W386752";

interface Scene {
  app: Express;
  seller: AuthedClient;
  buyer: AuthedClient;
  outsider: AuthedClient;
  bikeId: string;
  claimToken: string;
}

async function duplicateScene(): Promise<Scene> {
  const app = buildTestApp();
  const seller = await signUpAndSignIn(app);
  const buyer = await signUpAndSignIn(app);
  const outsider = await signUpAndSignIn(app);

  const bike = await request(app)
    .post("/api/bikes")
    .set("Cookie", seller.cookie)
    .send({ nickname: "Corolla", plate: "34ABC123", chassisNo: VIN, currentKm: 90_000 });

  const dup = await request(app)
    .post("/api/bikes")
    .set("Cookie", buyer.cookie)
    .send({ nickname: "Aldığım araba", chassisNo: VIN });
  expect(dup.status).toBe(409);

  return {
    app,
    seller,
    buyer,
    outsider,
    bikeId: bike.body.id,
    claimToken: dup.body.claimToken,
  };
}

/** Push a claim past its response window without waiting three weeks. */
function ageClaim(claimId: string): void {
  getDb()
    .prepare("UPDATE vehicle_claim SET expires_at = datetime('now', '-1 day') WHERE id = ?")
    .run(claimId);
}

describe("filing a claim", () => {
  it("lets the requester knock without ever learning who they are knocking on", async () => {
    const s = await duplicateScene();
    const claim = await request(s.app)
      .post("/api/vehicle-shares/claims")
      .set("Cookie", s.buyer.cookie)
      .send({ claimToken: s.claimToken, kind: "purchase", message: "Aracı 12 Mayıs'ta aldım" });
    expect(claim.status).toBe(201);

    const mine = await request(s.app)
      .get("/api/vehicle-shares/claims/outgoing")
      .set("Cookie", s.buyer.cookie);
    const blob = JSON.stringify(mine.body);
    expect(blob).not.toContain(s.bikeId);
    expect(blob).not.toContain(s.seller.user.id);
    expect(blob).not.toContain(s.seller.user.email);
    expect(blob).not.toContain("Corolla");
    expect(blob).not.toContain("34ABC123");
    // The only identifier echoed back is the one they typed themselves.
    expect(mine.body[0].identifierHint).toBe(VIN);
  });

  it("a claim token belongs to ONE user and cannot be passed around", async () => {
    const s = await duplicateScene();
    const stolen = await request(s.app)
      .post("/api/vehicle-shares/claims")
      .set("Cookie", s.outsider.cookie)
      .send({ claimToken: s.claimToken, kind: "access" });
    expect(stolen.status).toBe(404);
  });

  it("a claim token is single-use", async () => {
    const s = await duplicateScene();
    await request(s.app)
      .post("/api/vehicle-shares/claims")
      .set("Cookie", s.buyer.cookie)
      .send({ claimToken: s.claimToken, kind: "access" });
    const replay = await request(s.app)
      .post("/api/vehicle-shares/claims")
      .set("Cookie", s.buyer.cookie)
      .send({ claimToken: s.claimToken, kind: "purchase" });
    expect(replay.status).toBe(404);
  });

  it("reaches the holder, and NOBODY else", async () => {
    const s = await duplicateScene();
    await request(s.app)
      .post("/api/vehicle-shares/claims")
      .set("Cookie", s.buyer.cookie)
      .send({ claimToken: s.claimToken, kind: "purchase" });

    const held = await request(s.app)
      .get("/api/vehicle-shares/claims/incoming")
      .set("Cookie", s.seller.cookie);
    expect(held.body).toHaveLength(1);
    expect(held.body[0].requesterEmail).toBe(s.buyer.user.email);

    const nosy = await request(s.app)
      .get("/api/vehicle-shares/claims/incoming")
      .set("Cookie", s.outsider.cookie);
    expect(nosy.body).toEqual([]);
  });
});

describe("a claim cannot take a vehicle without approval", () => {
  it("does nothing at all while it is merely pending", async () => {
    const s = await duplicateScene();
    await request(s.app)
      .post("/api/vehicle-shares/claims")
      .set("Cookie", s.buyer.cookie)
      .send({ claimToken: s.claimToken, kind: "purchase" });
    expect((await request(s.app).get("/api/bikes").set("Cookie", s.buyer.cookie)).body).toEqual([]);
    const still = await request(s.app).get(`/api/bikes/${s.bikeId}`).set("Cookie", s.seller.cookie);
    expect(still.status).toBe(200);
  });

  it("cannot be approved by the person who filed it", async () => {
    const s = await duplicateScene();
    const claim = await request(s.app)
      .post("/api/vehicle-shares/claims")
      .set("Cookie", s.buyer.cookie)
      .send({ claimToken: s.claimToken, kind: "purchase" });
    const selfApprove = await request(s.app)
      .post(`/api/vehicle-shares/claims/${claim.body.id}/approve`)
      .set("Cookie", s.buyer.cookie)
      .send({});
    expect(selfApprove.status).toBe(404);
    expect((await request(s.app).get("/api/bikes").set("Cookie", s.buyer.cookie)).body).toEqual([]);
  });

  it("cannot be approved by a bystander", async () => {
    const s = await duplicateScene();
    const claim = await request(s.app)
      .post("/api/vehicle-shares/claims")
      .set("Cookie", s.buyer.cookie)
      .send({ claimToken: s.claimToken, kind: "purchase" });
    const res = await request(s.app)
      .post(`/api/vehicle-shares/claims/${claim.body.id}/approve`)
      .set("Cookie", s.outsider.cookie)
      .send({});
    expect(res.status).toBe(404);
  });

  it("NEVER transfers itself when the holder simply stops answering", async () => {
    // A VIN is readable through a windscreen at arm's length. If silence
    // eventually meant consent, anybody who walked past a car could take its
    // record — and a holder on a three-week holiday would lose their vehicle.
    const s = await duplicateScene();
    const claim = await request(s.app)
      .post("/api/vehicle-shares/claims")
      .set("Cookie", s.buyer.cookie)
      .send({ claimToken: s.claimToken, kind: "purchase" });
    ageClaim(claim.body.id);

    const still = await request(s.app).get(`/api/bikes/${s.bikeId}`).set("Cookie", s.seller.cookie);
    expect(still.status).toBe(200);
    expect(still.body.userId).toBe(s.seller.user.id);
    expect((await request(s.app).get("/api/bikes").set("Cookie", s.buyer.cookie)).body).toEqual([]);
  });

  it("expires an unanswered claim instead of leaving it in the holder's inbox", async () => {
    const s = await duplicateScene();
    const claim = await request(s.app)
      .post("/api/vehicle-shares/claims")
      .set("Cookie", s.buyer.cookie)
      .send({ claimToken: s.claimToken, kind: "purchase" });
    ageClaim(claim.body.id);
    const inbox = await request(s.app)
      .get("/api/vehicle-shares/claims/incoming")
      .set("Cookie", s.seller.cookie);
    expect(inbox.body).toEqual([]);
    const mine = await request(s.app)
      .get("/api/vehicle-shares/claims/outgoing")
      .set("Cookie", s.buyer.cookie);
    expect(mine.body[0].status).toBe("expired");
    expect(mine.body[0].separateRecordAvailable).toBe(true);
  });

  it("declining kills the claim, and no fallback is earned by a NO", async () => {
    const s = await duplicateScene();
    const claim = await request(s.app)
      .post("/api/vehicle-shares/claims")
      .set("Cookie", s.buyer.cookie)
      .send({ claimToken: s.claimToken, kind: "purchase" });
    const declined = await request(s.app)
      .post(`/api/vehicle-shares/claims/${claim.body.id}/decline`)
      .set("Cookie", s.seller.cookie)
      .send({});
    expect(declined.status).toBe(200);

    const mine = await request(s.app)
      .get("/api/vehicle-shares/claims/outgoing")
      .set("Cookie", s.buyer.cookie);
    expect(mine.body[0].status).toBe("declined");
    expect(mine.body[0].separateRecordAvailable).toBe(false);

    const fallback = await request(s.app)
      .post(`/api/vehicle-shares/claims/${claim.body.id}/separate-record`)
      .set("Cookie", s.buyer.cookie)
      .send({});
    expect(fallback.status).toBe(409);
  });
});

describe("the unresponsive-holder fallback", () => {
  it("gives the buyer a working record WITHOUT taking the incumbent's", async () => {
    const s = await duplicateScene();
    const claim = await request(s.app)
      .post("/api/vehicle-shares/claims")
      .set("Cookie", s.buyer.cookie)
      .send({ claimToken: s.claimToken, kind: "purchase" });
    ageClaim(claim.body.id);

    const own = await request(s.app)
      .post(`/api/vehicle-shares/claims/${claim.body.id}/separate-record`)
      .set("Cookie", s.buyer.cookie)
      .send({});
    expect(own.status).toBe(201);
    expect(own.body.identityContested).toBe(true);

    // The buyer has a vehicle they can use...
    const theirs = await request(s.app).get(`/api/bikes/${own.body.bikeId}`).set("Cookie", s.buyer.cookie);
    expect(theirs.status).toBe(200);
    expect(theirs.body.chassisNo).toBe(VIN);
    // ...and the incumbent lost absolutely nothing.
    const seller = await request(s.app).get(`/api/bikes/${s.bikeId}`).set("Cookie", s.seller.cookie);
    expect(seller.status).toBe(200);
    expect(seller.body.userId).toBe(s.seller.user.id);
    // The registry entry stayed where it was — the new record does not hold it.
    const holder = getDb()
      .prepare("SELECT bike_id FROM vehicle_identity WHERE kind = 'chassis'")
      .all() as { bike_id: string }[];
    expect(holder.map((r) => r.bike_id)).toEqual([s.bikeId]);
  });

  it("still costs a vehicle slot, so it cannot be used to mint capacity", async () => {
    const s = await duplicateScene();
    const claim = await request(s.app)
      .post("/api/vehicle-shares/claims")
      .set("Cookie", s.buyer.cookie)
      .send({ claimToken: s.claimToken, kind: "purchase" });
    ageClaim(claim.body.id);
    // Spend the buyer's single free slot elsewhere.
    await request(s.app).post("/api/bikes").set("Cookie", s.buyer.cookie).send({ nickname: "Başka" });
    const own = await request(s.app)
      .post(`/api/vehicle-shares/claims/${claim.body.id}/separate-record`)
      .set("Cookie", s.buyer.cookie)
      .send({});
    expect(own.status).toBe(403);
    expect(own.body.error).toBe("vehicle_limit_reached");
  });

  it("is offered once, not once per tap", async () => {
    const s = await duplicateScene();
    grantEntitlement(s.buyer.user.id);
    const claim = await request(s.app)
      .post("/api/vehicle-shares/claims")
      .set("Cookie", s.buyer.cookie)
      .send({ claimToken: s.claimToken, kind: "purchase" });
    ageClaim(claim.body.id);
    await request(s.app)
      .post(`/api/vehicle-shares/claims/${claim.body.id}/separate-record`)
      .set("Cookie", s.buyer.cookie)
      .send({});
    const again = await request(s.app)
      .post(`/api/vehicle-shares/claims/${claim.body.id}/separate-record`)
      .set("Cookie", s.buyer.cookie)
      .send({});
    expect(again.status).toBe(409);
  });
});

describe("what a handover moves", () => {
  /** Seller with a full record set, buyer with an approved purchase claim. */
  async function handedOver() {
    const s = await duplicateScene();
    // The seller's life, recorded against the car.
    const trip = await request(s.app)
      .post("/api/trips")
      .set("Cookie", s.seller.cookie)
      .send({
        bikeId: s.bikeId,
        distanceKm: 120,
        startedAt: "2026-04-01T07:00:00.000Z",
        endedAt: "2026-04-01T09:00:00.000Z",
        pointCount: 500,
        route: "gizli-rota",
      });
    const fuel = await request(s.app)
      .post("/api/fuel-logs")
      .set("Cookie", s.seller.cookie)
      .send({ bikeId: s.bikeId, filledOn: "2026-04-01", liters: 45, totalCost: 2100 });
    // The car's own history.
    const dated = await request(s.app)
      .post(`/api/bikes/${s.bikeId}/dated-items`)
      .set("Cookie", s.seller.cookie)
      .send({ type: "muayene", expiresOn: "2027-03-14" });
    const maint = await request(s.app)
      .post(`/api/bikes/${s.bikeId}/maintenance-items`)
      .set("Cookie", s.seller.cookie)
      .send({ kind: "engine_oil", lastDoneOn: "2026-02-01", lastDoneKm: 88_000 });
    // A scanned document belonging to the seller, inserted directly: the upload
    // route needs a real image, and what matters here is where the ROW ends up.
    const docId = "doc_handover_test";
    getDb()
      .prepare(
        "INSERT INTO document (id, user_id, bike_id, doc_type, file_path, mime_type, size_bytes) VALUES (?, ?, ?, 'ruhsat', '/tmp/x.jpg', 'image/jpeg', 1024)",
      )
      .run(docId, s.seller.user.id, s.bikeId);

    const claim = await request(s.app)
      .post("/api/vehicle-shares/claims")
      .set("Cookie", s.buyer.cookie)
      .send({ claimToken: s.claimToken, kind: "purchase" });
    const approved = await request(s.app)
      .post(`/api/vehicle-shares/claims/${claim.body.id}/approve`)
      .set("Cookie", s.seller.cookie)
      .send({});
    expect(approved.status).toBe(200);
    return { ...s, tripId: trip.body.id, fuelId: fuel.body.id, datedId: dated.body.id, maintId: maint.body.id, docId };
  }

  it("moves the vehicle and its FACTUAL history to the buyer", async () => {
    const h = await handedOver();
    const bike = await request(h.app).get(`/api/bikes/${h.bikeId}`).set("Cookie", h.buyer.cookie);
    expect(bike.status).toBe(200);
    expect(bike.body.userId).toBe(h.buyer.user.id);
    expect(bike.body.chassisNo).toBe(VIN);
    expect(bike.body.currentKm).toBe(90_000);

    const dated = await request(h.app)
      .get(`/api/bikes/${h.bikeId}/dated-items`)
      .set("Cookie", h.buyer.cookie);
    expect(dated.body).toHaveLength(1);
    expect(dated.body[0].expiresOn).toBe("2027-03-14");

    const maint = await request(h.app)
      .get(`/api/bikes/${h.bikeId}/maintenance-items`)
      .set("Cookie", h.buyer.cookie);
    expect(maint.body).toHaveLength(1);
    expect(maint.body[0].lastDoneKm).toBe(88_000);
  });

  it("does NOT move the seller's trips, fuel logs or documents", async () => {
    // The non-negotiable half. A scanned ruhsat carries the seller's TC kimlik,
    // name and address; the trip log is everywhere they drove.
    const h = await handedOver();
    expect((await request(h.app).get(`/api/trips?bikeId=${h.bikeId}`).set("Cookie", h.buyer.cookie)).body).toEqual([]);
    expect((await request(h.app).get(`/api/fuel-logs?bikeId=${h.bikeId}`).set("Cookie", h.buyer.cookie)).body).toEqual([]);
    expect((await request(h.app).get(`/api/documents?bikeId=${h.bikeId}`).set("Cookie", h.buyer.cookie)).body).toEqual([]);

    // Not merely hidden — unreachable by id too.
    expect((await request(h.app).get(`/api/trips/${h.tripId}`).set("Cookie", h.buyer.cookie)).status).toBe(404);
    expect((await request(h.app).get(`/api/documents/${h.docId}`).set("Cookie", h.buyer.cookie)).status).toBe(404);
    // And nowhere in the buyer's whole account.
    expect((await request(h.app).get("/api/trips").set("Cookie", h.buyer.cookie)).body).toEqual([]);
    expect((await request(h.app).get("/api/documents").set("Cookie", h.buyer.cookie)).body).toEqual([]);
  });

  it("leaves the seller their trips, fuel and documents on an archived record", async () => {
    const h = await handedOver();
    const trips = await request(h.app).get("/api/trips").set("Cookie", h.seller.cookie);
    expect(trips.body).toHaveLength(1);
    expect(trips.body[0].id).toBe(h.tripId);
    const fuel = await request(h.app).get("/api/fuel-logs").set("Cookie", h.seller.cookie);
    expect(fuel.body).toHaveLength(1);
    const docs = await request(h.app).get("/api/documents").set("Cookie", h.seller.cookie);
    expect(docs.body.map((d: { id: string }) => d.id)).toContain(h.docId);
    // On a record that is archived, so it costs them nothing.
    const archived = await request(h.app)
      .get("/api/bikes?archived=true")
      .set("Cookie", h.seller.cookie);
    expect(archived.body).toHaveLength(1);
    expect(archived.body[0].archived).toBe(true);
    // …and carries no identity that could contest the registry.
    expect(archived.body[0].chassisNo).toBeNull();
    expect(archived.body[0].plate).toBeNull();
  });

  it("takes the vehicle out of the seller's garage entirely", async () => {
    const h = await handedOver();
    expect((await request(h.app).get(`/api/bikes/${h.bikeId}`).set("Cookie", h.seller.cookie)).status).toBe(404);
    const ent = await request(h.app).get("/api/entitlement").set("Cookie", h.seller.cookie);
    expect(ent.body.activeVehicles).toBe(0);
  });

  it("drops the photo and the pointers into the seller's document wallet", async () => {
    const h = await handedOver();
    const bike = await request(h.app).get(`/api/bikes/${h.bikeId}`).set("Cookie", h.buyer.cookie);
    expect(bike.body.photoUrl).toBeNull();
    const dated = await request(h.app)
      .get(`/api/bikes/${h.bikeId}/dated-items`)
      .set("Cookie", h.buyer.cookie);
    // A dangling id to a document the buyer can never open is an invitation to
    // probe, so it is severed rather than left in the response.
    expect(dated.body[0].sourceDocumentId).toBeNull();
  });

  it("survives the seller deleting their account", async () => {
    // `dated_item.user_id` cascades from user(id). If it still pointed at the
    // seller, the buyer's service history would vanish the day the seller left —
    // which defeats the entire point of preserving it.
    const h = await handedOver();
    const del = await request(h.app)
      .delete("/api/me")
      .set("Cookie", h.seller.cookie)
      .send({ password: "supersecret123" });
    expect(del.status).toBe(204);

    const dated = await request(h.app)
      .get(`/api/bikes/${h.bikeId}/dated-items`)
      .set("Cookie", h.buyer.cookie);
    expect(dated.body).toHaveLength(1);
    const maint = await request(h.app)
      .get(`/api/bikes/${h.bikeId}/maintenance-items`)
      .set("Cookie", h.buyer.cookie);
    expect(maint.body).toHaveLength(1);
  });

  it("refuses when the BUYER has no room, and changes nothing", async () => {
    const s = await duplicateScene();
    await request(s.app).post("/api/bikes").set("Cookie", s.buyer.cookie).send({ nickname: "Dolu" });
    const claim = await request(s.app)
      .post("/api/vehicle-shares/claims")
      .set("Cookie", s.buyer.cookie)
      .send({ claimToken: s.claimToken, kind: "purchase" });
    const approved = await request(s.app)
      .post(`/api/vehicle-shares/claims/${claim.body.id}/approve`)
      .set("Cookie", s.seller.cookie)
      .send({});
    expect(approved.status).toBe(409);
    expect(approved.body.error).toBe("recipient_limit_reached");
    const still = await request(s.app).get(`/api/bikes/${s.bikeId}`).set("Cookie", s.seller.cookie);
    expect(still.status).toBe(200);
  });
});

describe("approving an ACCESS claim shares rather than gives away", () => {
  it("defaults to the least access, not the obvious one", async () => {
    const s = await duplicateScene();
    const claim = await request(s.app)
      .post("/api/vehicle-shares/claims")
      .set("Cookie", s.buyer.cookie)
      .send({ claimToken: s.claimToken, kind: "access" });
    const approved = await request(s.app)
      .post(`/api/vehicle-shares/claims/${claim.body.id}/approve`)
      .set("Cookie", s.seller.cookie)
      .send({});
    expect(approved.status).toBe(200);

    // The requester can see the car…
    const seen = await request(s.app).get("/api/bikes").set("Cookie", s.buyer.cookie);
    expect(seen.body.map((b: { id: string }) => b.id)).toEqual([s.bikeId]);
    // …and it is still the seller's, and still on the seller's bill.
    expect(seen.body[0].userId).toBe(s.seller.user.id);
    const ent = await request(s.app).get("/api/entitlement").set("Cookie", s.buyer.cookie);
    expect(ent.body.activeVehicles).toBe(0);
    // …as a GUEST: no journey log, no documents.
    expect(
      (await request(s.app).get(`/api/trips?bikeId=${s.bikeId}`).set("Cookie", s.buyer.cookie)).status,
    ).toBe(404);
  });

  it("a second decision on a settled claim does nothing", async () => {
    const s = await duplicateScene();
    const claim = await request(s.app)
      .post("/api/vehicle-shares/claims")
      .set("Cookie", s.buyer.cookie)
      .send({ claimToken: s.claimToken, kind: "access" });
    await request(s.app)
      .post(`/api/vehicle-shares/claims/${claim.body.id}/decline`)
      .set("Cookie", s.seller.cookie)
      .send({});
    const flip = await request(s.app)
      .post(`/api/vehicle-shares/claims/${claim.body.id}/approve`)
      .set("Cookie", s.seller.cookie)
      .send({});
    expect(flip.status).toBe(404);
  });
});

describe("a holder giving a vehicle away directly", () => {
  it("moves the same things an approved claim does", async () => {
    const app = buildTestApp();
    const seller = await signUpAndSignIn(app);
    const buyer = await signUpAndSignIn(app);
    const bike = await request(app)
      .post("/api/bikes")
      .set("Cookie", seller.cookie)
      .send({ nickname: "Corolla", chassisNo: VIN });
    await request(app)
      .post("/api/trips")
      .set("Cookie", seller.cookie)
      .send({
        bikeId: bike.body.id,
        distanceKm: 30,
        startedAt: "2026-04-01T07:00:00.000Z",
        endedAt: "2026-04-01T08:00:00.000Z",
        pointCount: 50,
      });

    const res = await request(app)
      .post(`/api/vehicle-shares/vehicles/${bike.body.id}/handover`)
      .set("Cookie", seller.cookie)
      .send({ email: buyer.user.email });
    expect(res.status).toBe(200);

    const now = await request(app).get(`/api/bikes/${bike.body.id}`).set("Cookie", buyer.cookie);
    expect(now.body.userId).toBe(buyer.user.id);
    expect((await request(app).get("/api/trips").set("Cookie", buyer.cookie)).body).toEqual([]);
    expect((await request(app).get("/api/trips").set("Cookie", seller.cookie)).body).toHaveLength(1);
  });

  it("cannot be aimed at somebody else's vehicle", async () => {
    const app = buildTestApp();
    const owner = await signUpAndSignIn(app);
    const thief = await signUpAndSignIn(app);
    const bike = await request(app)
      .post("/api/bikes")
      .set("Cookie", owner.cookie)
      .send({ nickname: "Corolla" });
    const res = await request(app)
      .post(`/api/vehicle-shares/vehicles/${bike.body.id}/handover`)
      .set("Cookie", thief.cookie)
      .send({ email: thief.user.email });
    expect(res.status).toBe(404);
    const still = await request(app).get(`/api/bikes/${bike.body.id}`).set("Cookie", owner.cookie);
    expect(still.body.userId).toBe(owner.user.id);
  });
});
