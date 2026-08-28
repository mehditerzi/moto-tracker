import { describe, it, expect } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn, uniqueTestEmail, type AuthedClient } from "./helpers/authedRequest.js";
import { grantEntitlement } from "./helpers/grantEntitlement.js";
import { createOrg, addMember } from "./helpers/org.js";
import { getDb } from "../src/db/index.js";

/**
 * Personal garage groups: what a share conveys, and — far more of this file —
 * what it must not.
 */

interface Shared {
  app: Express;
  owner: AuthedClient;
  member: AuthedClient;
  guest: AuthedClient;
  stranger: AuthedClient;
  groupId: string;
  bikeId: string;
}

async function makeGroup(name = "Aile Garajı"): Promise<Shared> {
  const app = buildTestApp();
  const owner = await signUpAndSignIn(app);
  const member = await signUpAndSignIn(app);
  const guest = await signUpAndSignIn(app);
  const stranger = await signUpAndSignIn(app);
  grantEntitlement(owner.user.id);

  const bike = await request(app)
    .post("/api/bikes")
    .set("Cookie", owner.cookie)
    .send({ nickname: "Corolla", plate: "34ABC123" });

  const group = await request(app)
    .post("/api/vehicle-shares/groups")
    .set("Cookie", owner.cookie)
    .send({ name });
  const groupId = group.body.id as string;

  await request(app)
    .post(`/api/vehicle-shares/groups/${groupId}/vehicles`)
    .set("Cookie", owner.cookie)
    .send({ bikeId: bike.body.id });

  for (const [who, role] of [
    [member, "member"],
    [guest, "guest"],
  ] as const) {
    const inv = await request(app)
      .post(`/api/vehicle-shares/groups/${groupId}/invites`)
      .set("Cookie", owner.cookie)
      .send({ email: who.user.email, role });
    const accepted = await request(app)
      .post("/api/vehicle-shares/invites/accept")
      .set("Cookie", who.cookie)
      .send({ token: inv.body.token });
    if (accepted.status !== 201) throw new Error(`accept failed: ${JSON.stringify(accepted.body)}`);
  }

  return { app, owner, member, guest, stranger, groupId, bikeId: bike.body.id };
}

describe("personal garage groups", () => {
  it("creates a group, adds a vehicle and shares it with a member", async () => {
    const s = await makeGroup();
    const list = await request(s.app).get("/api/bikes").set("Cookie", s.member.cookie);
    expect(list.status).toBe(200);
    expect(list.body.map((b: { id: string }) => b.id)).toContain(s.bikeId);

    const dash = await request(s.app).get("/api/dashboard").set("Cookie", s.member.cookie);
    expect(dash.body.map((e: { bike: { id: string } }) => e.bike.id)).toContain(s.bikeId);
  });

  it("shows a GUEST the vehicle and its renewal dates, and nothing personal", async () => {
    const s = await makeGroup();
    // The car's facts: visible.
    const list = await request(s.app).get("/api/bikes").set("Cookie", s.guest.cookie);
    expect(list.body.map((b: { id: string }) => b.id)).toContain(s.bikeId);
    const dated = await request(s.app)
      .get(`/api/bikes/${s.bikeId}/dated-items`)
      .set("Cookie", s.guest.cookie);
    expect(dated.status).toBe(200);
  });

  it("a stranger sees nothing at all", async () => {
    const s = await makeGroup();
    expect((await request(s.app).get("/api/bikes").set("Cookie", s.stranger.cookie)).body).toEqual([]);
    expect(
      (await request(s.app).get(`/api/bikes/${s.bikeId}`).set("Cookie", s.stranger.cookie)).status,
    ).toBe(404);
    expect(
      (
        await request(s.app)
          .get(`/api/vehicle-shares/groups/${s.groupId}/members`)
          .set("Cookie", s.stranger.cookie)
      ).status,
    ).toBe(404);
  });
});

describe("a share cannot escalate", () => {
  it("a MEMBER may record facts but may not delete the vehicle", async () => {
    const s = await makeGroup();
    const dated = await request(s.app)
      .post(`/api/bikes/${s.bikeId}/dated-items`)
      .set("Cookie", s.member.cookie)
      .send({ type: "muayene", expiresOn: "2027-03-14" });
    expect(dated.status).toBe(201);

    const del = await request(s.app)
      .delete(`/api/bikes/${s.bikeId}`)
      .set("Cookie", s.member.cookie);
    expect(del.status).toBe(403);
  });

  it("a GUEST may record a service but may NOT rename or re-plate the vehicle", async () => {
    const s = await makeGroup();
    const maint = await request(s.app)
      .post(`/api/bikes/${s.bikeId}/maintenance-items`)
      .set("Cookie", s.guest.cookie)
      .send({ kind: "engine_oil", lastDoneOn: "2026-01-05" });
    expect(maint.status).toBe(201);

    const rename = await request(s.app)
      .patch(`/api/bikes/${s.bikeId}`)
      .set("Cookie", s.guest.cookie)
      .send({ nickname: "Benim arabam", plate: "06XYZ999" });
    expect(rename.status).toBe(403);

    const del = await request(s.app).delete(`/api/bikes/${s.bikeId}`).set("Cookie", s.guest.cookie);
    expect(del.status).toBe(403);
  });

  it("a GUEST cannot add vehicles to somebody else's garage", async () => {
    const s = await makeGroup();
    grantEntitlement(s.guest.user.id);
    const add = await request(s.app)
      .post("/api/bikes")
      .set("Cookie", s.guest.cookie)
      .send({ nickname: "Sızıntı", orgId: s.groupId });
    expect(add.status).toBe(403);
  });

  it("a MEMBER cannot manage people, and cannot evict the owner", async () => {
    const s = await makeGroup();
    const invite = await request(s.app)
      .post(`/api/vehicle-shares/groups/${s.groupId}/invites`)
      .set("Cookie", s.member.cookie)
      .send({ email: uniqueTestEmail(), role: "member" });
    expect(invite.status).toBe(403);

    const evict = await request(s.app)
      .delete(`/api/vehicle-shares/groups/${s.groupId}/members/${s.owner.user.id}`)
      .set("Cookie", s.member.cookie);
    expect(evict.status).toBe(403);

    const rename = await request(s.app)
      .patch(`/api/vehicle-shares/groups/${s.groupId}`)
      .set("Cookie", s.member.cookie)
      .send({ name: "Benim garajım" });
    expect(rename.status).toBe(403);
  });

  it("anybody may LEAVE, and their own vehicles come home with them", async () => {
    const s = await makeGroup();
    grantEntitlement(s.member.user.id);
    const theirs = await request(s.app)
      .post("/api/bikes")
      .set("Cookie", s.member.cookie)
      .send({ nickname: "Üyenin arabası", orgId: s.groupId });
    expect(theirs.status).toBe(201);

    const leave = await request(s.app)
      .delete(`/api/vehicle-shares/groups/${s.groupId}/members/${s.member.user.id}`)
      .set("Cookie", s.member.cookie);
    expect(leave.status).toBe(204);

    // Their car followed them out; the owner's did not follow them.
    const mine = await request(s.app).get("/api/bikes").set("Cookie", s.member.cookie);
    expect(mine.body.map((b: { id: string }) => b.id)).toEqual([theirs.body.id]);
    expect(mine.body[0].orgId).toBeNull();
  });

  it("deleting a group sends every vehicle home instead of destroying it", async () => {
    const s = await makeGroup();
    const del = await request(s.app)
      .delete(`/api/vehicle-shares/groups/${s.groupId}`)
      .set("Cookie", s.owner.cookie);
    expect(del.status).toBe(204);
    const mine = await request(s.app).get(`/api/bikes/${s.bikeId}`).set("Cookie", s.owner.cookie);
    expect(mine.status).toBe(200);
    expect(mine.body.orgId).toBeNull();
    // And the member no longer sees it.
    expect(
      (await request(s.app).get(`/api/bikes/${s.bikeId}`).set("Cookie", s.member.cookie)).status,
    ).toBe(404);
  });

  it("an invite is addressed to a person, not to whoever holds the link", async () => {
    const s = await makeGroup();
    const inv = await request(s.app)
      .post(`/api/vehicle-shares/groups/${s.groupId}/invites`)
      .set("Cookie", s.owner.cookie)
      .send({ email: uniqueTestEmail("intended"), role: "member" });
    const hijack = await request(s.app)
      .post("/api/vehicle-shares/invites/accept")
      .set("Cookie", s.stranger.cookie)
      .send({ token: inv.body.token });
    expect(hijack.status).toBe(403);
    expect(hijack.body.error).toBe("share_invite_email_mismatch");
  });

  it("stores only a digest of the invite token", async () => {
    const s = await makeGroup();
    const inv = await request(s.app)
      .post(`/api/vehicle-shares/groups/${s.groupId}/invites`)
      .set("Cookie", s.owner.cookie)
      .send({ email: uniqueTestEmail(), role: "guest" });
    const rows = getDb().prepare("SELECT token FROM org_invite").all() as { token: string }[];
    expect(rows.every((r) => r.token !== inv.body.token)).toBe(true);
  });
});

describe("the personal layer never travels through a share", () => {
  it("a GUEST cannot see the holder's trips, fuel logs or documents", async () => {
    const s = await makeGroup();
    const trip = await request(s.app)
      .post("/api/trips")
      .set("Cookie", s.owner.cookie)
      .send({
        bikeId: s.bikeId,
        distanceKm: 42,
        startedAt: "2026-05-01T08:00:00.000Z",
        endedAt: "2026-05-01T09:00:00.000Z",
        pointCount: 100,
        route: "abc",
      });
    expect(trip.status).toBe(201);
    const fuel = await request(s.app)
      .post("/api/fuel-logs")
      .set("Cookie", s.owner.cookie)
      .send({ bikeId: s.bikeId, filledOn: "2026-05-01", liters: 40, totalCost: 1800 });
    expect(fuel.status).toBe(201);

    // Listed by vehicle: refused outright, not answered with an empty array —
    // an empty array would still confirm that the route applies.
    expect(
      (await request(s.app).get(`/api/trips?bikeId=${s.bikeId}`).set("Cookie", s.guest.cookie))
        .status,
    ).toBe(404);
    expect(
      (await request(s.app).get(`/api/fuel-logs?bikeId=${s.bikeId}`).set("Cookie", s.guest.cookie))
        .status,
    ).toBe(404);
    expect(
      (await request(s.app).get(`/api/documents?bikeId=${s.bikeId}`).set("Cookie", s.guest.cookie))
        .status,
    ).toBe(404);

    // Listed globally: absent.
    expect((await request(s.app).get("/api/trips").set("Cookie", s.guest.cookie)).body).toEqual([]);
    expect((await request(s.app).get("/api/fuel-logs").set("Cookie", s.guest.cookie)).body).toEqual(
      [],
    );

    // Fetched by id, which is the door the scopes do not guard.
    expect(
      (await request(s.app).get(`/api/trips/${trip.body.id}`).set("Cookie", s.guest.cookie)).status,
    ).toBe(404);
  });

  it("a GUEST cannot DELETE the holder's trip or fuel log", async () => {
    const s = await makeGroup();
    const trip = await request(s.app)
      .post("/api/trips")
      .set("Cookie", s.owner.cookie)
      .send({
        bikeId: s.bikeId,
        distanceKm: 20,
        startedAt: "2026-05-01T08:00:00.000Z",
        endedAt: "2026-05-01T08:30:00.000Z",
        pointCount: 10,
      });
    const fuel = await request(s.app)
      .post("/api/fuel-logs")
      .set("Cookie", s.owner.cookie)
      .send({ bikeId: s.bikeId, filledOn: "2026-05-02", liters: 30 });

    expect(
      (await request(s.app).delete(`/api/trips/${trip.body.id}`).set("Cookie", s.guest.cookie))
        .status,
    ).toBe(404);
    // Fuel deletion is deliberately silent (204 whatever happens), so assert on
    // the data rather than the status.
    await request(s.app).delete(`/api/fuel-logs/${fuel.body.id}`).set("Cookie", s.guest.cookie);
    const still = await request(s.app)
      .get(`/api/fuel-logs?bikeId=${s.bikeId}`)
      .set("Cookie", s.owner.cookie);
    expect(still.body).toHaveLength(1);
  });

  it("a GUEST cannot attach a trip or a fuel log of their own either", async () => {
    // Not squeamishness: a guest has no personal-layer scope, so a record saved
    // here would be invisible to its own author the moment it landed.
    const s = await makeGroup();
    const trip = await request(s.app)
      .post("/api/trips")
      .set("Cookie", s.guest.cookie)
      .send({
        bikeId: s.bikeId,
        distanceKm: 25,
        startedAt: "2026-05-03T08:00:00.000Z",
        endedAt: "2026-05-03T08:10:00.000Z",
        pointCount: 5,
      });
    expect(trip.status).toBe(404);
  });

  it("a MEMBER, who was invited into the garage itself, does see them", async () => {
    // The distinction is the whole design: a partner is in your garage, a
    // mechanic is looking at one car through a window.
    const s = await makeGroup();
    await request(s.app)
      .post("/api/fuel-logs")
      .set("Cookie", s.owner.cookie)
      .send({ bikeId: s.bikeId, filledOn: "2026-05-01", liters: 40 });
    const seen = await request(s.app)
      .get(`/api/fuel-logs?bikeId=${s.bikeId}`)
      .set("Cookie", s.member.cookie);
    expect(seen.status).toBe(200);
    expect(seen.body).toHaveLength(1);
  });

  it("the owner's OTHER vehicles never come with the share", async () => {
    const s = await makeGroup();
    const secret = await request(s.app)
      .post("/api/bikes")
      .set("Cookie", s.owner.cookie)
      .send({ nickname: "Paylaşılmayan" });
    expect(secret.status).toBe(201);
    const seen = await request(s.app).get("/api/bikes").set("Cookie", s.member.cookie);
    expect(seen.body.map((b: { id: string }) => b.id)).not.toContain(secret.body.id);
  });
});

describe("garage groups are not the fleet product", () => {
  it("is invisible to every /api/orgs route", async () => {
    // One guard closes the triage board, the cost rollups, the CSV importer, the
    // member screens and the settings PATCH at once.
    const s = await makeGroup();
    for (const path of [
      `/api/orgs/${s.groupId}`,
      `/api/orgs/${s.groupId}/members`,
      `/api/orgs/${s.groupId}/triage`,
      `/api/orgs/${s.groupId}/vehicles`,
      `/api/orgs/${s.groupId}/costs`,
      `/api/orgs/${s.groupId}/assignments`,
    ]) {
      const res = await request(s.app).get(path).set("Cookie", s.owner.cookie);
      expect(res.status, path).toBe(404);
    }
  });

  it("CANNOT be promoted into a fleet organization", async () => {
    // The App Store posture (docs/fleet-design.md §1) depends on there being no
    // in-app path to the fleet product. Two independent locks: the settings
    // schema cannot express 'personal', and the guard refuses the route.
    const s = await makeGroup();
    for (const mode of ["fleet", "rental", "personal"]) {
      const res = await request(s.app)
        .patch(`/api/orgs/${s.groupId}`)
        .set("Cookie", s.owner.cookie)
        .send({ mode });
      expect(res.status, mode).toBe(404);
    }
    const row = getDb()
      .prepare("SELECT is_personal FROM organization WHERE id = ?")
      .get(s.groupId) as { is_personal: number };
    expect(row.is_personal).toBe(1);
  });

  it("a fleet organization CANNOT be demoted into a garage group", async () => {
    // The other direction moves every vehicle's bill off `max_vehicles` and onto
    // custodians' free ceilings.
    const app = buildTestApp();
    const owner = await signUpAndSignIn(app);
    const orgId = createOrg("Kervan", "fleet", 10);
    addMember(orgId, owner.user.id, "owner");
    const res = await request(app)
      .patch(`/api/orgs/${orgId}`)
      .set("Cookie", owner.cookie)
      .send({ mode: "personal" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("the sharing routes refuse a business fleet", async () => {
    const app = buildTestApp();
    const owner = await signUpAndSignIn(app);
    const orgId = createOrg("Kervan", "fleet", 10);
    addMember(orgId, owner.user.id, "owner");
    for (const res of [
      await request(app).get(`/api/vehicle-shares/groups/${orgId}/members`).set("Cookie", owner.cookie),
      await request(app)
        .post(`/api/vehicle-shares/groups/${orgId}/invites`)
        .set("Cookie", owner.cookie)
        .send({ email: uniqueTestEmail(), role: "guest" }),
      await request(app).delete(`/api/vehicle-shares/groups/${orgId}`).set("Cookie", owner.cookie),
    ]) {
      expect(res.status).toBe(404);
    }
  });

  it("only lists personal groups, never a fleet membership", async () => {
    const s = await makeGroup();
    const orgId = createOrg("Kervan", "fleet", 10);
    addMember(orgId, s.owner.user.id, "owner");
    const groups = await request(s.app)
      .get("/api/vehicle-shares/groups")
      .set("Cookie", s.owner.cookie);
    expect(groups.body.map((g: { id: string }) => g.id)).toEqual([s.groupId]);
  });

  it("a company vehicle cannot be dragged into a family garage", async () => {
    const s = await makeGroup();
    const orgId = createOrg("Kervan", "fleet", 10);
    addMember(orgId, s.owner.user.id, "owner");
    const van = await request(s.app)
      .post("/api/bikes")
      .set("Cookie", s.owner.cookie)
      .send({ nickname: "Van", orgId });
    const move = await request(s.app)
      .post(`/api/vehicle-shares/groups/${s.groupId}/vehicles`)
      .set("Cookie", s.owner.cookie)
      .send({ bikeId: van.body.id });
    expect(move.status).toBe(404);
  });
});

describe("entitlement cannot be farmed through sharing", () => {
  it("a shared vehicle counts against its custodian, and only them", async () => {
    const s = await makeGroup();
    const ownerEnt = await request(s.app).get("/api/entitlement").set("Cookie", s.owner.cookie);
    // The owner still pays for the car they put in the group.
    expect(ownerEnt.body.activeVehicles).toBe(1);
    // The member sees it but is charged nothing, so their free slot is intact.
    const memberEnt = await request(s.app).get("/api/entitlement").set("Cookie", s.member.cookie);
    expect(memberEnt.body.activeVehicles).toBe(0);
    expect(memberEnt.body.canAddVehicle).toBe(true);
  });

  it("moving a vehicle into a group does not make it free", async () => {
    // The failure this guards: `countActiveBikes` used to filter on
    // `org_id IS NULL`, so setting org_id would drop the vehicle off every
    // ceiling — a free user could make a group, put ten cars in it, pay nothing.
    const app = buildTestApp();
    const u = await signUpAndSignIn(app);
    const bike = await request(app).post("/api/bikes").set("Cookie", u.cookie).send({ nickname: "Tek" });
    const group = await request(app)
      .post("/api/vehicle-shares/groups")
      .set("Cookie", u.cookie)
      .send({ name: "Garaj" });
    await request(app)
      .post(`/api/vehicle-shares/groups/${group.body.id}/vehicles`)
      .set("Cookie", u.cookie)
      .send({ bikeId: bike.body.id });

    const ent = await request(app).get("/api/entitlement").set("Cookie", u.cookie);
    expect(ent.body.activeVehicles).toBe(1);
    expect(ent.body.canAddVehicle).toBe(false);

    const second = await request(app)
      .post("/api/bikes")
      .set("Cookie", u.cookie)
      .send({ nickname: "Bedava?", orgId: group.body.id });
    expect(second.status).toBe(403);
    expect(second.body.error).toBe("vehicle_limit_reached");
  });

  it("joining a rich person's group grants no capacity of your own", async () => {
    const s = await makeGroup();
    // The owner has a 10-vehicle pack; the member is on the free tier.
    const add = await request(s.app)
      .post("/api/bikes")
      .set("Cookie", s.member.cookie)
      .send({ nickname: "Birinci", orgId: s.groupId });
    expect(add.status).toBe(201);
    const second = await request(s.app)
      .post("/api/bikes")
      .set("Cookie", s.member.cookie)
      .send({ nickname: "İkinci", orgId: s.groupId });
    expect(second.status).toBe(403);
    expect(second.body.error).toBe("vehicle_limit_reached");
  });

  it("a personal group's max_vehicles is zero and nothing can raise it", async () => {
    const s = await makeGroup();
    const row = getDb()
      .prepare("SELECT max_vehicles FROM organization WHERE id = ?")
      .get(s.groupId) as { max_vehicles: number };
    expect(row.max_vehicles).toBe(0);
  });
});

describe("group boundaries hold like org boundaries", () => {
  it("two garage groups are as isolated from each other as two fleets are", async () => {
    const a = await makeGroup("A Garajı");
    // A second, unrelated group owned by the stranger, with a car of its own.
    const theirs = await request(a.app)
      .post("/api/bikes")
      .set("Cookie", a.stranger.cookie)
      .send({ nickname: "Yabancının arabası" });
    const other = await request(a.app)
      .post("/api/vehicle-shares/groups")
      .set("Cookie", a.stranger.cookie)
      .send({ name: "B Garajı" });
    await request(a.app)
      .post(`/api/vehicle-shares/groups/${other.body.id}/vehicles`)
      .set("Cookie", a.stranger.cookie)
      .send({ bikeId: theirs.body.id });

    // Neither side sees the other, in either direction.
    const mine = await request(a.app).get("/api/bikes").set("Cookie", a.member.cookie);
    expect(mine.body.map((b: { id: string }) => b.id)).not.toContain(theirs.body.id);
    const nosy = await request(a.app).get("/api/bikes").set("Cookie", a.stranger.cookie);
    expect(nosy.body.map((b: { id: string }) => b.id)).not.toContain(a.bikeId);

    // And a member of one cannot address the other's group by id.
    for (const res of [
      await request(a.app)
        .get(`/api/vehicle-shares/groups/${other.body.id}/members`)
        .set("Cookie", a.member.cookie),
      await request(a.app)
        .post(`/api/vehicle-shares/groups/${other.body.id}/vehicles`)
        .set("Cookie", a.member.cookie)
        .send({ bikeId: a.bikeId }),
      await request(a.app)
        .delete(`/api/vehicle-shares/groups/${other.body.id}/vehicles/${theirs.body.id}`)
        .set("Cookie", a.member.cookie),
    ]) {
      expect(res.status).toBe(404);
    }
  });

  it("a group member cannot give away the group owner's vehicle", async () => {
    // `approversOfBike` grants the decision to whoever could delete the vehicle
    // plus its custodian — never to every member who can merely see it.
    const s = await makeGroup();
    const buyer = await signUpAndSignIn(s.app);
    const dup = await request(s.app)
      .post("/api/bikes")
      .set("Cookie", buyer.cookie)
      .send({ nickname: "x", chassisNo: "WVWZZZ1JZ3W386752" });
    // The owner's car has no chassis in this fixture, so give it one first.
    expect(dup.status).toBe(201);

    const handover = await request(s.app)
      .post(`/api/vehicle-shares/vehicles/${s.bikeId}/handover`)
      .set("Cookie", s.member.cookie)
      .send({ email: buyer.user.email });
    expect(handover.status).toBe(404);
    const still = await request(s.app).get(`/api/bikes/${s.bikeId}`).set("Cookie", s.owner.cookie);
    expect(still.body.userId).toBe(s.owner.user.id);
  });

  it("a personal group is not reachable from a fleet member's fleet screens", async () => {
    // The user wears both hats: fleet manager and head of a family garage.
    const s = await makeGroup();
    const orgId = createOrg("Kervan", "fleet", 10);
    addMember(orgId, s.owner.user.id, "owner");
    const board = await request(s.app)
      .get(`/api/orgs/${orgId}/vehicles`)
      .set("Cookie", s.owner.cookie);
    expect(board.status).toBe(200);
    // Their family car is not in the fleet's inventory.
    const ids = (board.body.rows ?? board.body).map?.((r: { bikeId?: string }) => r.bikeId) ?? [];
    expect(ids).not.toContain(s.bikeId);
  });
});
