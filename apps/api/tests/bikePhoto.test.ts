import { describe, it, expect } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";

function png() {
  return sharp({ create: { width: 12, height: 12, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .png()
    .toBuffer();
}

async function makeBike(app: ReturnType<typeof buildTestApp>, cookie: string) {
  const res = await request(app).post("/api/bikes").set("Cookie", cookie).send({ nickname: "Monster" });
  return res.body;
}

describe("bike photo", () => {
  it("upload → serve → delete round-trip", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bike = await makeBike(app, cookie);
    expect(bike.photoUrl).toBeNull();

    const buf = await png();
    const up = await request(app)
      .post(`/api/bikes/${bike.id}/photo`)
      .set("Cookie", cookie)
      .attach("file", buf, "p.png");
    expect(up.status).toBe(201);
    expect(up.body.photoUrl).toContain(`/api/bikes/${bike.id}/photo`);

    const file = await request(app).get(`/api/bikes/${bike.id}/photo`).set("Cookie", cookie);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toContain("image/jpeg");

    const del = await request(app).delete(`/api/bikes/${bike.id}/photo`).set("Cookie", cookie);
    expect(del.status).toBe(204);

    const gone = await request(app).get(`/api/bikes/${bike.id}/photo`).set("Cookie", cookie);
    expect(gone.status).toBe(404);
  });

  it("rejects a non-image upload", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bike = await makeBike(app, cookie);
    const res = await request(app)
      .post(`/api/bikes/${bike.id}/photo`)
      .set("Cookie", cookie)
      .attach("file", Buffer.from("not an image"), "x.txt");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("lists a vehicle's scanned documents", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bike = await makeBike(app, cookie);
    const buf = await png();
    await request(app)
      .post(`/api/documents?bikeId=${bike.id}`)
      .set("Cookie", cookie)
      .attach("file", buf, "doc.png");
    const list = await request(app).get(`/api/documents?bikeId=${bike.id}`).set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(1);
    expect(list.body[0].bikeId).toBe(bike.id);
  });
});
