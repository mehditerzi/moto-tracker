import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";

describe("/api/bikes", () => {
  it("requires auth", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/bikes");
    expect(res.status).toBe(401);
  });

  it("create + list + get + patch + archive", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);

    const create = await request(app)
      .post("/api/bikes")
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send({ nickname: "Monster", plate: "34ABC123", make: "Ducati", year: 2023 });
    expect(create.status).toBe(201);
    const id = create.body.id;
    expect(create.body.nickname).toBe("Monster");

    const list = await request(app).get("/api/bikes").set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(id);

    const get1 = await request(app).get(`/api/bikes/${id}`).set("Cookie", cookie);
    expect(get1.status).toBe(200);

    const patched = await request(app)
      .patch(`/api/bikes/${id}`)
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send({ nickname: "Monster 937", currentKm: 1234 });
    expect(patched.status).toBe(200);
    expect(patched.body.nickname).toBe("Monster 937");
    expect(patched.body.currentKm).toBe(1234);

    const del = await request(app).delete(`/api/bikes/${id}`).set("Cookie", cookie);
    expect(del.status).toBe(204);

    const list2 = await request(app).get("/api/bikes").set("Cookie", cookie);
    expect(list2.body).toHaveLength(0);

    const list3 = await request(app).get("/api/bikes?archived=true").set("Cookie", cookie);
    expect(list3.body).toHaveLength(1);
    expect(list3.body[0].archived).toBe(true);
  });

  it("does not leak bikes across users", async () => {
    const app = buildTestApp();
    const u1 = await signUpAndSignIn(app, "alice@test.com");
    const u2 = await signUpAndSignIn(app, "bob@test.com");

    await request(app)
      .post("/api/bikes")
      .set("Cookie", u1.cookie)
      .set("Content-Type", "application/json")
      .send({ nickname: "Alice's bike" });

    const u2List = await request(app).get("/api/bikes").set("Cookie", u2.cookie);
    expect(u2List.status).toBe(200);
    expect(u2List.body).toHaveLength(0);
  });

  it("rejects malformed body", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app)
      .post("/api/bikes")
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send({ nickname: "" });
    expect(res.status).toBe(400);
  });
});
