import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { closeDb, resetDbForTests } from "../src/db/index.js";
import { config } from "../src/config.js";
import { runMigrations } from "../src/db/migrate.js";

function directives(header: string): Record<string, string> {
  return Object.fromEntries(
    header
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...rest] = d.split(/\s+/);
        return [name!, rest.join(" ")];
      }),
  );
}

describe("security headers", () => {
  it("ships a CSP that locks scripts down without breaking MapKit or the ride socket", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/health");
    // The policy ships report-only by default (CSP_REPORT_ONLY) so a wrong
    // directive cannot disable Capacitor's native plugins on installed devices.
    // The directives themselves must be identical either way, so accept both
    // header names here and assert the mode separately below.
    const csp =
      res.headers["content-security-policy"] ??
      res.headers["content-security-policy-report-only"];
    expect(csp).toBeTruthy();
    const d = directives(csp);

    // Scripts: allow-listed only. A stored-XSS payload in user text must not run.
    expect(d["script-src"]).toBe("'self' https://cdn.apple-mapkit.com");
    expect(d["script-src"]).not.toMatch(/unsafe-(inline|eval)/);
    expect(d["object-src"]).toBe("'none'");
    expect(d["base-uri"]).toBe("'self'");
    expect(d["frame-ancestors"]).toBe("'none'");

    // Things the app genuinely needs.
    expect(d["img-src"]).toContain("'self'"); // /api/bikes/:id/photo, /api/documents/:id/file
    expect(d["img-src"]).toContain("blob:"); // camera previews
    expect(d["img-src"]).toContain("https://*.apple-mapkit.com"); // map tiles
    expect(d["connect-src"]).toContain("ws://localhost:8787"); // /api/ride-ws
    expect(d["connect-src"]).toContain("https://*.apple-mapkit.com");
    expect(d["worker-src"]).toContain("blob:"); // MapKit workers
    // Unavoidable: framer-motion writes inline style attributes.
    expect(d["style-src"]).toContain("'unsafe-inline'");
    // APP_BASE_URL is http in tests/dev — forcing https would break local calls.
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("defaults to report-only, and enforces when CSP_REPORT_ONLY=false", async () => {
    // Default: observe violations without blocking. Enforcing a bad policy would
    // kill StoreKit / push / geolocation on every installed device at once,
    // because the iOS wrapper loads the live site via Capacitor's server.url.
    const reportOnly = await request(buildTestApp()).get("/api/health");
    expect(reportOnly.headers["content-security-policy-report-only"]).toBeTruthy();
    expect(reportOnly.headers["content-security-policy"]).toBeUndefined();

    const original = config.CSP_REPORT_ONLY;
    (config as { CSP_REPORT_ONLY: boolean }).CSP_REPORT_ONLY = false;
    try {
      const enforced = await request(buildTestApp()).get("/api/health");
      expect(enforced.headers["content-security-policy"]).toBeTruthy();
      expect(enforced.headers["content-security-policy-report-only"]).toBeUndefined();
      // Same policy in both modes — only the header name changes.
      expect(enforced.headers["content-security-policy"]).toBe(
        reportOnly.headers["content-security-policy-report-only"],
      );
    } finally {
      (config as { CSP_REPORT_ONLY: boolean }).CSP_REPORT_ONLY = original;
    }
  });
});

describe("/api/health", () => {
  afterEach(() => {
    resetDbForTests(":memory:");
    runMigrations();
  });

  it("reports ready when the database answers", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, service: "mototracker-api", db: "up" });
  });

  it("liveness stays cheap and dependency-free", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/health/live");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.db).toBeUndefined();
  });

  it("returns 503 when the database cannot be reached", async () => {
    const app = buildTestApp();
    closeDb();
    // /dev/null is not a directory — opening a DB under it always fails.
    (config as { DATABASE_PATH: string }).DATABASE_PATH = "/dev/null/nope/app.db";
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, db: "down" });
  });
});
