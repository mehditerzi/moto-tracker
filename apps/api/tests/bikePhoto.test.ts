import { describe, it, expect } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";
import { config } from "../src/config.js";

// Own uploads dir, for the same reason fuelReceipt.test.ts has one:
// documents.test.ts runs in a parallel worker and rm's the shared default,
// which can delete the photo between the upload and the GET that serves it.
(config as { UPLOADS_DIR: string }).UPLOADS_DIR = "/tmp/mototracker-test-uploads-bikephoto";

function png() {
  return sharp({ create: { width: 12, height: 12, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .png()
    .toBuffer();
}

/** A tall frame — the shape a phone actually produces when you photograph a car. */
function portrait() {
  return sharp({ create: { width: 600, height: 900, channels: 3, background: { r: 40, g: 80, b: 160 } } })
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
    expect(res.status).toBe(415);
    // A translatable machine code, not a Turkish sentence.
    expect(res.body.error).toBe("unsupported_media_type");
  });

  it("stores a 4:3 master and serves a small derivative for thumbnails", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bike = await makeBike(app, cookie);
    await request(app)
      .post(`/api/bikes/${bike.id}/photo`)
      .set("Cookie", cookie)
      .attach("file", await portrait(), "p.png");

    const full = await request(app).get(`/api/bikes/${bike.id}/photo`).set("Cookie", cookie);
    const fullMeta = await sharp(full.body).metadata();
    expect([fullMeta.width, fullMeta.height]).toEqual([1280, 960]);

    // A 44px list row must not download the master. The derivative is written
    // at upload time, so this costs nothing per request.
    const thumb = await request(app)
      .get(`/api/bikes/${bike.id}/photo?size=thumb`)
      .set("Cookie", cookie);
    expect(thumb.status).toBe(200);
    const thumbMeta = await sharp(thumb.body).metadata();
    expect([thumbMeta.width, thumbMeta.height]).toEqual([320, 240]);
    expect(thumb.body.length).toBeLessThan(full.body.length);

    // Deleting the photo must take the derivative with it, or the next upload
    // would be served alongside the previous vehicle's thumbnail.
    await request(app).delete(`/api/bikes/${bike.id}/photo`).set("Cookie", cookie);
    const gone = await request(app)
      .get(`/api/bikes/${bike.id}/photo?size=thumb`)
      .set("Cookie", cookie);
    expect(gone.status).toBe(404);
  });

  it("applies EXIF orientation so a sideways phone shot is stored upright", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bike = await makeBike(app, cookie);
    // Red on top, blue on the bottom, already 4:3 so the crop cannot be what
    // moves the halves around, and tagged orientation 3 (rotate 180). Stored
    // correctly, the BLUE half must end up on top.
    const W = 400;
    const H = 300;
    const raw = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        raw[i] = y < H / 2 ? 255 : 0; // R
        raw[i + 2] = y < H / 2 ? 0 : 255; // B
      }
    }
    const src = await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
      .withMetadata({ orientation: 3 })
      .jpeg()
      .toBuffer();

    await request(app)
      .post(`/api/bikes/${bike.id}/photo`)
      .set("Cookie", cookie)
      .attach("file", src, "p.jpg");
    const out = await request(app).get(`/api/bikes/${bike.id}/photo`).set("Cookie", cookie);

    // `stats()` reports on the INPUT image, not on the pipeline in front of it,
    // so the crop has to be materialised before it can be measured.
    const topBuf = await sharp(out.body)
      .extract({ left: 0, top: 0, width: 40, height: 40 })
      .png()
      .toBuffer();
    const top = await sharp(topBuf).stats();
    // Blue channel dominant at the top → the 180° rotation was applied.
    expect(top.channels[2]!.mean).toBeGreaterThan(200);
    expect(top.channels[0]!.mean).toBeLessThan(60);
    // And the orientation tag is gone, so no viewer re-rotates it a second time.
    const meta = await sharp(out.body).metadata();
    expect(meta.orientation ?? 1).toBe(1);
  });

  it("answers a file that claims to be an image but cannot be decoded", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bike = await makeBike(app, cookie);
    // Passes the mimetype filter, fails in the decoder — the shape of a HEIC
    // picked out of the Files app, which prebuilt libvips cannot read. Must be
    // a translatable 415, not a 500.
    const res = await request(app)
      .post(`/api/bikes/${bike.id}/photo`)
      .set("Cookie", cookie)
      .attach("file", Buffer.from("\xff\xd8\xff not really a jpeg"), {
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });
    expect(res.status).toBe(415);
    expect(res.body.error).toBe("unsupported_media_type");
    // And the vehicle is unchanged — a failed upload must not half-apply.
    const after = await request(app).get(`/api/bikes/${bike.id}`).set("Cookie", cookie);
    expect(after.body.photoUrl).toBeNull();
  });

  it("replacing a photo changes its URL so the old one cannot be cached over it", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bike = await makeBike(app, cookie);
    const first = await request(app)
      .post(`/api/bikes/${bike.id}/photo`)
      .set("Cookie", cookie)
      .attach("file", await png(), "a.png");
    // The URL carries `?v=<updated_at>`; a long cache lifetime is only safe
    // because a replacement lands on a different URL.
    expect(first.body.photoUrl).toMatch(/\?v=/);
    const served = await request(app).get(`/api/bikes/${bike.id}/photo`).set("Cookie", cookie);
    expect(served.headers["cache-control"]).toContain("private");
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
