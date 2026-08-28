import { describe, it, expect } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn, uniqueTestEmail, type AuthedClient } from "./helpers/authedRequest.js";
import { grantEntitlement } from "./helpers/grantEntitlement.js";
import { createOrg, addMember } from "./helpers/org.js";
import { getDb } from "../src/db/index.js";

/**
 * GARAGE GROUPS — named collections of vehicles ("Ducatis", "Arabalarım"), which
 * a user makes for themselves and may then share.
 *
 * vehicleShares.test.ts pins what a SHARE conveys. This file pins the thing
 * underneath it that 029 changed: **a vehicle may be in several groups at once**,
 * and a group is a label on a vehicle rather than a place the vehicle moves to.
 * Almost every test below would have been impossible to write before, because
 * `bike.org_id` was a single column.
 */

interface Fixture {
  app: Express;
  owner: AuthedClient;
  bikes: string[];
}

/** One user with a paid pack and three vehicles: a Monster, a Panigale, a car. */
async function garage(): Promise<Fixture> {
  const app = buildTestApp();
  const owner = await signUpAndSignIn(app);
  grantEntitlement(owner.user.id);
  const bikes: string[] = [];
  for (const [nickname, make] of [
    ["Monster", "Ducati"],
    ["Panigale", "Ducati"],
    ["Corolla", "Toyota"],
  ] as const) {
    const res = await request(app)
      .post("/api/bikes")
      .set("Cookie", owner.cookie)
      .send({ nickname, make });
    if (res.status !== 201) throw new Error(`bike failed: ${JSON.stringify(res.body)}`);
    bikes.push(res.body.id as string);
  }
  return { app, owner, bikes };
}

async function makeGroup(f: Fixture, name: string): Promise<string> {
  const res = await request(f.app)
    .post("/api/vehicle-shares/groups")
    .set("Cookie", f.owner.cookie)
    .send({ name });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

function bikeById(body: { id: string }[], id: string) {
  return body.find((b) => b.id === id) as { id: string; groupIds: string[]; orgId: string | null };
}

describe("a vehicle belongs to as many groups as the owner likes", () => {
  it("files one bike under two overlapping collections", async () => {
    // THE CASE THE FEATURE EXISTS FOR. "Ducatis" and "Motorlarım" are not
    // alternatives — a Monster is in both — and a single `org_id` column could
    // never have expressed it.
    const f = await garage();
    const ducatis = await makeGroup(f, "Ducatiler");
    const motors = await makeGroup(f, "Motorlarım");

    for (const groupId of [ducatis, motors]) {
      for (const bikeId of [f.bikes[0]!, f.bikes[1]!]) {
        const res = await request(f.app)
          .post(`/api/vehicle-shares/groups/${groupId}/vehicles`)
          .set("Cookie", f.owner.cookie)
          .send({ bikeId });
        expect(res.status).toBe(204);
      }
    }

    const list = await request(f.app).get("/api/bikes").set("Cookie", f.owner.cookie);
    expect(bikeById(list.body, f.bikes[0]!).groupIds.sort()).toEqual([ducatis, motors].sort());
    // The car is in neither.
    expect(bikeById(list.body, f.bikes[2]!).groupIds).toEqual([]);

    const groups = await request(f.app)
      .get("/api/vehicle-shares/groups")
      .set("Cookie", f.owner.cookie);
    for (const g of groups.body) expect(g.vehicleCount).toBe(2);
  });

  it("a grouped vehicle is still an ordinary personal vehicle", async () => {
    // The single most important consequence of 029: filing a car under a label
    // must not change what the car IS. `orgId` stays null, which is what keeps
    // it on its owner's entitlement and out of every fleet query.
    const f = await garage();
    const g = await makeGroup(f, "Ducatiler");
    await request(f.app)
      .post(`/api/vehicle-shares/groups/${g}/vehicles`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.bikes[0]! });

    const one = await request(f.app)
      .get(`/api/bikes/${f.bikes[0]}`)
      .set("Cookie", f.owner.cookie);
    expect(one.body.orgId).toBeNull();
    expect(one.body.groupIds).toEqual([g]);
    const row = getDb().prepare("SELECT org_id FROM bike WHERE id = ?").get(f.bikes[0]) as {
      org_id: string | null;
    };
    expect(row.org_id).toBeNull();
  });

  it("adding the same vehicle twice is success, not a conflict", async () => {
    const f = await garage();
    const g = await makeGroup(f, "Ducatiler");
    for (let i = 0; i < 2; i++) {
      const res = await request(f.app)
        .post(`/api/vehicle-shares/groups/${g}/vehicles`)
        .set("Cookie", f.owner.cookie)
        .send({ bikeId: f.bikes[0]! });
      expect(res.status).toBe(204);
    }
    const groups = await request(f.app)
      .get("/api/vehicle-shares/groups")
      .set("Cookie", f.owner.cookie);
    expect(groups.body[0].vehicleCount).toBe(1);
  });

  it("removing a vehicle from one group leaves it in the others", async () => {
    const f = await garage();
    const a = await makeGroup(f, "Ducatiler");
    const b = await makeGroup(f, "Motorlarım");
    for (const g of [a, b]) {
      await request(f.app)
        .post(`/api/vehicle-shares/groups/${g}/vehicles`)
        .set("Cookie", f.owner.cookie)
        .send({ bikeId: f.bikes[0]! });
    }
    const del = await request(f.app)
      .delete(`/api/vehicle-shares/groups/${a}/vehicles/${f.bikes[0]}`)
      .set("Cookie", f.owner.cookie);
    expect(del.status).toBe(204);

    const list = await request(f.app).get("/api/bikes").set("Cookie", f.owner.cookie);
    expect(bikeById(list.body, f.bikes[0]!).groupIds).toEqual([b]);
  });

  it("lists the vehicles in one group", async () => {
    const f = await garage();
    const g = await makeGroup(f, "Ducatiler");
    await request(f.app)
      .post(`/api/vehicle-shares/groups/${g}/vehicles`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.bikes[1]! });
    const res = await request(f.app)
      .get(`/api/vehicle-shares/groups/${g}/vehicles`)
      .set("Cookie", f.owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body.bikeIds).toEqual([f.bikes[1]]);
  });

  it("renaming a group keeps its vehicles", async () => {
    const f = await garage();
    const g = await makeGroup(f, "Ducatiler");
    await request(f.app)
      .post(`/api/vehicle-shares/groups/${g}/vehicles`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.bikes[0]! });
    const res = await request(f.app)
      .patch(`/api/vehicle-shares/groups/${g}`)
      .set("Cookie", f.owner.cookie)
      .send({ name: "Kırmızılar" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Kırmızılar");
    expect(res.body.vehicleCount).toBe(1);
  });

  it("deleting a group deletes the label and NOTHING else", async () => {
    // A group is a way of looking at vehicles. Deleting one must never be a way
    // of losing them.
    const f = await garage();
    const g = await makeGroup(f, "Ducatiler");
    await request(f.app)
      .post(`/api/vehicle-shares/groups/${g}/vehicles`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.bikes[0]! });
    expect(
      (
        await request(f.app)
          .delete(`/api/vehicle-shares/groups/${g}`)
          .set("Cookie", f.owner.cookie)
      ).status,
    ).toBe(204);

    const list = await request(f.app).get("/api/bikes").set("Cookie", f.owner.cookie);
    expect(list.body).toHaveLength(3);
    expect(bikeById(list.body, f.bikes[0]!).groupIds).toEqual([]);
    // …and the join rows went with the group rather than being orphaned.
    const left = getDb().prepare("SELECT COUNT(*) AS n FROM bike_group").get() as { n: number };
    expect(left.n).toBe(0);
  });
});

describe("setting a vehicle's groups in one write", () => {
  it("replaces the whole set, and is idempotent", async () => {
    const f = await garage();
    const a = await makeGroup(f, "Ducatiler");
    const b = await makeGroup(f, "Motorlarım");
    const c = await makeGroup(f, "Satılık");

    const put = (groupIds: string[]) =>
      request(f.app)
        .put(`/api/vehicle-shares/vehicles/${f.bikes[0]}/groups`)
        .set("Cookie", f.owner.cookie)
        .send({ groupIds });

    expect((await put([a, b])).body.groupIds.sort()).toEqual([a, b].sort());
    // Unticking b, ticking c — one write, not a diff of three.
    expect((await put([a, c])).body.groupIds.sort()).toEqual([a, c].sort());
    // Same again changes nothing.
    expect((await put([a, c])).body.groupIds.sort()).toEqual([a, c].sort());
    // And clearing it works.
    expect((await put([])).body.groupIds).toEqual([]);
  });

  it("refuses a group the caller is not in, without writing anything", async () => {
    const f = await garage();
    const mine = await makeGroup(f, "Ducatiler");
    const stranger = await signUpAndSignIn(f.app);
    const theirs = await request(f.app)
      .post("/api/vehicle-shares/groups")
      .set("Cookie", stranger.cookie)
      .send({ name: "Onların garajı" });

    const res = await request(f.app)
      .put(`/api/vehicle-shares/vehicles/${f.bikes[0]}/groups`)
      .set("Cookie", f.owner.cookie)
      .send({ groupIds: [mine, theirs.body.id] });
    expect(res.status).toBe(404);
    // The valid half of the request must not have landed either.
    const list = await request(f.app).get("/api/bikes").set("Cookie", f.owner.cookie);
    expect(bikeById(list.body, f.bikes[0]!).groupIds).toEqual([]);
  });

  it("refuses somebody else's vehicle", async () => {
    const f = await garage();
    const g = await makeGroup(f, "Ducatiler");
    const stranger = await signUpAndSignIn(f.app);
    const theirs = await request(f.app)
      .post("/api/bikes")
      .set("Cookie", stranger.cookie)
      .send({ nickname: "Onların arabası" });
    const res = await request(f.app)
      .put(`/api/vehicle-shares/vehicles/${theirs.body.id}/groups`)
      .set("Cookie", f.owner.cookie)
      .send({ groupIds: [g] });
    expect(res.status).toBe(404);
  });
});

describe("grouping cannot mint free vehicle capacity", () => {
  it("a free user with one car cannot get a second by grouping", async () => {
    // The farming hole, checked at the shape 029 moved it to. Ten groups do not
    // buy a second slot, because the vehicle never leaves the personal garage.
    const app = buildTestApp();
    const u = await signUpAndSignIn(app);
    const bike = await request(app)
      .post("/api/bikes")
      .set("Cookie", u.cookie)
      .send({ nickname: "Tek" });
    const groups: string[] = [];
    for (const name of ["A", "B", "C"]) {
      const g = await request(app)
        .post("/api/vehicle-shares/groups")
        .set("Cookie", u.cookie)
        .send({ name });
      groups.push(g.body.id);
      await request(app)
        .post(`/api/vehicle-shares/groups/${g.body.id}/vehicles`)
        .set("Cookie", u.cookie)
        .send({ bikeId: bike.body.id });
    }

    const ent = await request(app).get("/api/entitlement").set("Cookie", u.cookie);
    // Counted ONCE, not zero times and not three times.
    expect(ent.body.activeVehicles).toBe(1);
    expect(ent.body.canAddVehicle).toBe(false);

    for (const orgId of [null, groups[0]]) {
      const second = await request(app)
        .post("/api/bikes")
        .set("Cookie", u.cookie)
        .send({ nickname: "Bedava?", ...(orgId ? { orgId } : {}) });
      expect(second.status).toBe(403);
      expect(second.body.error).toBe("vehicle_limit_reached");
    }
  });
});

describe("groups compose with sharing", () => {
  /** Owner with two Ducatis in one group, plus a member and a guest in it. */
  async function shared() {
    const f = await garage();
    const groupId = await makeGroup(f, "Ducatiler");
    for (const bikeId of [f.bikes[0]!, f.bikes[1]!]) {
      await request(f.app)
        .post(`/api/vehicle-shares/groups/${groupId}/vehicles`)
        .set("Cookie", f.owner.cookie)
        .send({ bikeId });
    }
    const member = await signUpAndSignIn(f.app);
    const guest = await signUpAndSignIn(f.app);
    for (const [who, role] of [
      [member, "member"],
      [guest, "guest"],
    ] as const) {
      const inv = await request(f.app)
        .post(`/api/vehicle-shares/groups/${groupId}/invites`)
        .set("Cookie", f.owner.cookie)
        .send({ email: who.user.email, role });
      const ok = await request(f.app)
        .post("/api/vehicle-shares/invites/accept")
        .set("Cookie", who.cookie)
        .send({ token: inv.body.token });
      expect(ok.status).toBe(201);
    }
    return { ...f, groupId, member, guest };
  }

  it("sharing a group shares exactly the vehicles in it", async () => {
    const s = await shared();
    const seen = await request(s.app).get("/api/bikes").set("Cookie", s.member.cookie);
    expect(seen.body.map((b: { id: string }) => b.id).sort()).toEqual(
      [s.bikes[0], s.bikes[1]].sort(),
    );
    // The Corolla was never in the group, so it never travelled.
    expect(seen.body.map((b: { id: string }) => b.id)).not.toContain(s.bikes[2]);
  });

  it("filing a shared car into a SECOND, private group shares nothing more", async () => {
    // Visibility is the union over a vehicle's groups, so a private collection
    // of one's own can never take access away — and, since the second group has
    // no other members, it can never add any either.
    const s = await shared();
    const private_ = await makeGroup(s, "Kırmızılar");
    await request(s.app)
      .post(`/api/vehicle-shares/groups/${private_}/vehicles`)
      .set("Cookie", s.owner.cookie)
      .send({ bikeId: s.bikes[0]! });

    const seen = await request(s.app).get("/api/bikes").set("Cookie", s.member.cookie);
    expect(seen.body.map((b: { id: string }) => b.id).sort()).toEqual(
      [s.bikes[0], s.bikes[1]].sort(),
    );
    // And the member is not told the private group's name — it is a fact about
    // the owner, not about the car.
    expect(bikeById(seen.body, s.bikes[0]!).groupIds).toEqual([s.groupId]);
  });

  it("the STRONGEST role wins when a vehicle is reachable through two groups", async () => {
    // The owner puts a car in the guest's-eye group AND shares it fully via a
    // second group with the same person. They must end up a member, not a guest:
    // intersecting would mean adding a group could take access away.
    const s = await shared();
    const full = await makeGroup(s, "Aile");
    await request(s.app)
      .post(`/api/vehicle-shares/groups/${full}/vehicles`)
      .set("Cookie", s.owner.cookie)
      .send({ bikeId: s.bikes[0]! });
    const inv = await request(s.app)
      .post(`/api/vehicle-shares/groups/${full}/invites`)
      .set("Cookie", s.owner.cookie)
      .send({ email: s.guest.user.email, role: "member" });
    await request(s.app)
      .post("/api/vehicle-shares/invites/accept")
      .set("Cookie", s.guest.cookie)
      .send({ token: inv.body.token });

    await request(s.app)
      .post("/api/fuel-logs")
      .set("Cookie", s.owner.cookie)
      .send({ bikeId: s.bikes[0]!, filledOn: "2026-05-01", liters: 40 });

    // Member-through-the-second-group: the personal layer is now visible…
    const fuel = await request(s.app)
      .get(`/api/fuel-logs?bikeId=${s.bikes[0]}`)
      .set("Cookie", s.guest.cookie);
    expect(fuel.status).toBe(200);
    expect(fuel.body).toHaveLength(1);
    // …on THAT car only. The other Ducati is still guest-only.
    expect(
      (
        await request(s.app)
          .get(`/api/fuel-logs?bikeId=${s.bikes[1]}`)
          .set("Cookie", s.guest.cookie)
      ).status,
    ).toBe(404);
  });

  it("the custodian keeps full control of their own car inside somebody else's group", async () => {
    // Ownership beats every group role. Without this, accepting an invitation
    // could demote you on your own vehicle.
    const s = await shared();
    grantEntitlement(s.member.user.id);
    const theirs = await request(s.app)
      .post("/api/bikes")
      .set("Cookie", s.member.cookie)
      .send({ nickname: "Üyenin arabası", orgId: s.groupId });
    expect(theirs.status).toBe(201);
    // A member normally cannot delete a vehicle out of a group — but this one is
    // theirs.
    const del = await request(s.app)
      .delete(`/api/bikes/${theirs.body.id}`)
      .set("Cookie", s.member.cookie);
    expect(del.status).toBe(204);
  });

  it("leaving a group takes only your OWN cars out of it", async () => {
    const s = await shared();
    grantEntitlement(s.member.user.id);
    const theirs = await request(s.app)
      .post("/api/bikes")
      .set("Cookie", s.member.cookie)
      .send({ nickname: "Üyenin arabası", orgId: s.groupId });
    await request(s.app)
      .delete(`/api/vehicle-shares/groups/${s.groupId}/members/${s.member.user.id}`)
      .set("Cookie", s.member.cookie);

    const mine = await request(s.app).get("/api/bikes").set("Cookie", s.member.cookie);
    expect(mine.body.map((b: { id: string }) => b.id)).toEqual([theirs.body.id]);
    expect(mine.body[0].groupIds).toEqual([]);
    // The owner's two Ducatis stayed in the group.
    const groups = await request(s.app)
      .get("/api/vehicle-shares/groups")
      .set("Cookie", s.owner.cookie);
    expect(groups.body[0].vehicleCount).toBe(2);
  });

  it("a one-tap share targets the group the caller points at", async () => {
    const s = await shared();
    const other = await makeGroup(s, "Kırmızılar");
    const friend = await signUpAndSignIn(s.app);
    const res = await request(s.app)
      .post(`/api/vehicle-shares/vehicles/${s.bikes[0]}/share`)
      .set("Cookie", s.owner.cookie)
      .send({ email: friend.user.email, role: "guest", groupId: other });
    expect(res.status).toBe(201);
    expect(res.body.groupId).toBe(other);
    // …and the vehicle is now in that group too.
    const list = await request(s.app).get("/api/bikes").set("Cookie", s.owner.cookie);
    expect(bikeById(list.body, s.bikes[0]!).groupIds.sort()).toEqual([s.groupId, other].sort());
  });

  it("a one-tap share refuses to GUESS when a vehicle is in several groups", async () => {
    // It makes a fresh one-vehicle group instead. Guessing would attach a person
    // to a collection they were never shown, which is the one mistake this
    // feature must not make quietly.
    const s = await shared();
    const other = await makeGroup(s, "Kırmızılar");
    await request(s.app)
      .post(`/api/vehicle-shares/groups/${other}/vehicles`)
      .set("Cookie", s.owner.cookie)
      .send({ bikeId: s.bikes[0]! });
    const friend = await signUpAndSignIn(s.app);
    const res = await request(s.app)
      .post(`/api/vehicle-shares/vehicles/${s.bikes[0]}/share`)
      .set("Cookie", s.owner.cookie)
      .send({ email: friend.user.email, role: "guest" });
    expect(res.status).toBe(201);
    expect([s.groupId, other]).not.toContain(res.body.groupId);
  });

  it("a group created implicitly by sharing is a normal, visible group", async () => {
    // The gap the owner reported: a share used to make a group nobody could see
    // or manage. It appears in the list, it can be renamed, and more vehicles
    // can be filed in it.
    const f = await garage();
    const friend = await signUpAndSignIn(f.app);
    const share = await request(f.app)
      .post(`/api/vehicle-shares/vehicles/${f.bikes[0]}/share`)
      .set("Cookie", f.owner.cookie)
      .send({ email: friend.user.email, role: "guest" });
    expect(share.status).toBe(201);
    const groupId = share.body.groupId as string;

    const groups = await request(f.app)
      .get("/api/vehicle-shares/groups")
      .set("Cookie", f.owner.cookie);
    expect(groups.body.map((g: { id: string }) => g.id)).toEqual([groupId]);
    expect(groups.body[0].vehicleCount).toBe(1);

    expect(
      (
        await request(f.app)
          .patch(`/api/vehicle-shares/groups/${groupId}`)
          .set("Cookie", f.owner.cookie)
          .send({ name: "Ducatiler" })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(f.app)
          .post(`/api/vehicle-shares/groups/${groupId}/vehicles`)
          .set("Cookie", f.owner.cookie)
          .send({ bikeId: f.bikes[1]! })
      ).status,
    ).toBe(204);
  });
});

describe("groups are not a way into the fleet product", () => {
  it("a company vehicle cannot be filed in a garage group, at either layer", async () => {
    const f = await garage();
    const g = await makeGroup(f, "Ducatiler");
    const orgId = createOrg("Kervan", "fleet", 10);
    addMember(orgId, f.owner.user.id, "owner");
    const van = await request(f.app)
      .post("/api/bikes")
      .set("Cookie", f.owner.cookie)
      .send({ nickname: "Van", orgId });

    // The route refuses…
    expect(
      (
        await request(f.app)
          .post(`/api/vehicle-shares/groups/${g}/vehicles`)
          .set("Cookie", f.owner.cookie)
          .send({ bikeId: van.body.id })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(f.app)
          .put(`/api/vehicle-shares/vehicles/${van.body.id}/groups`)
          .set("Cookie", f.owner.cookie)
          .send({ groupIds: [g] })
      ).status,
    ).toBe(404);
    // …and so does the schema, whatever a future route thinks.
    expect(() =>
      getDb()
        .prepare("INSERT INTO bike_group (bike_id, org_id) VALUES (?, ?)")
        .run(van.body.id, g),
    ).toThrow(/bike_group_requires_personal_vehicle/);
  });

  it("a garage group cannot be pointed at a BUSINESS organization", async () => {
    const f = await garage();
    const orgId = createOrg("Kervan", "fleet", 10);
    addMember(orgId, f.owner.user.id, "owner");
    expect(() =>
      getDb()
        .prepare("INSERT INTO bike_group (bike_id, org_id) VALUES (?, ?)")
        .run(f.bikes[0], orgId),
    ).toThrow(/bike_group_requires_personal_group/);
  });

  it("a vehicle moved into a company loses every garage group on the way in", async () => {
    const f = await garage();
    const g = await makeGroup(f, "Ducatiler");
    await request(f.app)
      .post(`/api/vehicle-shares/groups/${g}/vehicles`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.bikes[0]! });
    const orgId = createOrg("Kervan", "fleet", 10);
    addMember(orgId, f.owner.user.id, "owner");
    // No route does this; the trigger exists for the ones that might (an import,
    // an admin fix) — a vehicle must never be both a company asset and a
    // household's.
    getDb().prepare("UPDATE bike SET org_id = ? WHERE id = ?").run(orgId, f.bikes[0]);
    const left = getDb()
      .prepare("SELECT COUNT(*) AS n FROM bike_group WHERE bike_id = ?")
      .get(f.bikes[0]) as { n: number };
    expect(left.n).toBe(0);
  });

  it("group routes stay invisible to the fleet API and vice versa", async () => {
    const f = await garage();
    const g = await makeGroup(f, "Ducatiler");
    for (const path of [`/api/orgs/${g}`, `/api/orgs/${g}/vehicles`, `/api/orgs/${g}/triage`]) {
      expect((await request(f.app).get(path).set("Cookie", f.owner.cookie)).status, path).toBe(404);
    }
    const orgId = createOrg("Kervan", "fleet", 10);
    addMember(orgId, f.owner.user.id, "owner");
    expect(
      (
        await request(f.app)
          .get(`/api/vehicle-shares/groups/${orgId}/vehicles`)
          .set("Cookie", f.owner.cookie)
      ).status,
    ).toBe(404);
  });
});

describe("a group is a lens, so it never lets a stranger in", () => {
  it("a stranger cannot read, fill or empty a group they are not in", async () => {
    const f = await garage();
    const g = await makeGroup(f, "Ducatiler");
    await request(f.app)
      .post(`/api/vehicle-shares/groups/${g}/vehicles`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.bikes[0]! });
    const stranger = await signUpAndSignIn(f.app);
    for (const res of [
      await request(f.app)
        .get(`/api/vehicle-shares/groups/${g}/vehicles`)
        .set("Cookie", stranger.cookie),
      await request(f.app)
        .post(`/api/vehicle-shares/groups/${g}/vehicles`)
        .set("Cookie", stranger.cookie)
        .send({ bikeId: f.bikes[0]! }),
      await request(f.app)
        .delete(`/api/vehicle-shares/groups/${g}/vehicles/${f.bikes[0]}`)
        .set("Cookie", stranger.cookie),
      await request(f.app)
        .patch(`/api/vehicle-shares/groups/${g}`)
        .set("Cookie", stranger.cookie)
        .send({ name: "Benim" }),
    ]) {
      expect(res.status).toBe(404);
    }
  });

  it("a GUEST cannot file their own car into the group they were let into", async () => {
    // Otherwise a mechanic could drop a bike into their shop's garage and pick
    // up everyone else in it.
    const f = await garage();
    const g = await makeGroup(f, "Ducatiler");
    await request(f.app)
      .post(`/api/vehicle-shares/groups/${g}/vehicles`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.bikes[0]! });
    const guest = await signUpAndSignIn(f.app);
    const inv = await request(f.app)
      .post(`/api/vehicle-shares/groups/${g}/invites`)
      .set("Cookie", f.owner.cookie)
      .send({ email: guest.user.email, role: "guest" });
    await request(f.app)
      .post("/api/vehicle-shares/invites/accept")
      .set("Cookie", guest.cookie)
      .send({ token: inv.body.token });

    const theirs = await request(f.app)
      .post("/api/bikes")
      .set("Cookie", guest.cookie)
      .send({ nickname: "Ustanın motoru" });
    expect(theirs.status).toBe(201);
    expect(
      (
        await request(f.app)
          .post(`/api/vehicle-shares/groups/${g}/vehicles`)
          .set("Cookie", guest.cookie)
          .send({ bikeId: theirs.body.id })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(f.app)
          .put(`/api/vehicle-shares/vehicles/${theirs.body.id}/groups`)
          .set("Cookie", guest.cookie)
          .send({ groupIds: [g] })
      ).status,
    ).toBe(404);
  });

  it("a sold vehicle leaves every group it was in", async () => {
    const f = await garage();
    const g = await makeGroup(f, "Ducatiler");
    await request(f.app)
      .post(`/api/vehicle-shares/groups/${g}/vehicles`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.bikes[0]! });
    const buyer = await signUpAndSignIn(f.app);
    const res = await request(f.app)
      .post(`/api/vehicle-shares/vehicles/${f.bikes[0]}/handover`)
      .set("Cookie", f.owner.cookie)
      .send({ email: buyer.user.email });
    expect(res.status).toBe(200);

    const left = getDb()
      .prepare("SELECT COUNT(*) AS n FROM bike_group WHERE bike_id = ?")
      .get(f.bikes[0]) as { n: number };
    expect(left.n).toBe(0);
    // The buyer holds an ungrouped, ordinary personal vehicle.
    const theirs = await request(f.app).get("/api/bikes").set("Cookie", buyer.cookie);
    expect(bikeById(theirs.body, f.bikes[0]!).groupIds).toEqual([]);
  });

  it("caps how many groups one person can have", async () => {
    const f = await garage();
    for (let i = 0; i < 10; i++) await makeGroup(f, `G${i}`);
    const over = await request(f.app)
      .post("/api/vehicle-shares/groups")
      .set("Cookie", f.owner.cookie)
      .send({ name: "On birinci" });
    expect(over.status).toBe(403);
    expect(over.body.error).toBe("share_group_limit_reached");
  });

  it("rejects an empty or over-long group name", async () => {
    const f = await garage();
    for (const name of ["", "x".repeat(81)]) {
      const res = await request(f.app)
        .post("/api/vehicle-shares/groups")
        .set("Cookie", f.owner.cookie)
        .send({ name });
      expect(res.status).toBe(400);
    }
    expect(
      (
        await request(f.app)
          .post("/api/vehicle-shares/groups")
          .set("Cookie", f.owner.cookie)
          .send({ name: uniqueTestEmail() })
      ).status,
    ).toBe(201);
  });
});
