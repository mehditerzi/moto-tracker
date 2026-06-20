import { describe, it, expect } from "vitest";
import { buildTestApp } from "./helpers/buildApp.js";
import request from "supertest";

describe("/privacy", () => {
  it("serves the privacy policy as public HTML with no auth", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/privacy");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain("Privacy Policy");
    expect(res.text).toContain("mehditerzi32@hotmail.com");
  });
});
