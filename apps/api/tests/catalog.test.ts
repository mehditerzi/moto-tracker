import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";

describe("/api/catalog", () => {
  it("requires auth", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/catalog/makes");
    expect(res.status).toBe(401);
  });

  it("searches makes by query", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app).get("/api/catalog/makes?q=yam").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toContain("Yamaha");
  });

  it("filters makes by vehicle type", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const cars = await request(app).get("/api/catalog/makes?q=fiat&type=car").set("Cookie", cookie);
    expect(cars.body).toContain("Fiat");
    // A car-only brand should not appear under motorcycle.
    const moto = await request(app).get("/api/catalog/makes?q=fiat&type=motorcycle").set("Cookie", cookie);
    expect(moto.body).not.toContain("Fiat");
  });

  it("returns models for a make, type-scoped", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const moto = await request(app)
      .get("/api/catalog/models?make=Honda&type=motorcycle")
      .set("Cookie", cookie);
    expect(moto.body.some((m: string) => /CB|CBR|PCX/.test(m))).toBe(true);
    const cars = await request(app)
      .get("/api/catalog/models?make=Honda&type=car&q=civ")
      .set("Cookie", cookie);
    expect(cars.body).toContain("Civic");
  });

  it("still matches mid-word substrings through the FTS path (3+ chars)", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    // "dav" only appears in the middle of "Harley-Davidson" → this is the case
    // the trigram index has to answer exactly like the old full scan did.
    const mid = await request(app).get("/api/catalog/makes?q=dav").set("Cookie", cookie);
    expect(mid.status).toBe(200);
    expect(mid.body.some((n: string) => /davidson/i.test(n))).toBe(true);
    // 1–2 character queries take the plain scan and must behave the same.
    const short = await request(app).get("/api/catalog/makes?q=ya").set("Cookie", cookie);
    expect(short.body).toContain("Yamaha");
  });

  it("ranks an exact match first, then prefix matches", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app).get("/api/catalog/makes?q=honda").set("Cookie", cookie);
    expect(res.body[0]).toBe("Honda");
  });

  it("resolves models via make alias", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app).get("/api/catalog/models?make=harley").set("Cookie", cookie);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

/**
 * Coverage the Turkish market actually needs. Neither free upstream can supply
 * this — vPIC is US registrations and Renault/Dacia/Peugeot/Citroën/Opel/Škoda/
 * Seat/Togg have effectively no US presence — so these assertions are what stops
 * the curated overlay in scripts/fetch-moto-catalog.mjs being quietly gutted by
 * a regeneration that ran without it.
 */
describe("/api/catalog Turkish-market car coverage", () => {
  it("carries real model lists for the brands Turkey actually drives", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const expected: [string, string[]][] = [
      ["Fiat", ["Egea", "Doblo", "Fiorino", "Linea", "Albea"]],
      ["Renault", ["Clio", "Megane", "Symbol", "Taliant", "Fluence"]],
      ["Dacia", ["Sandero", "Duster", "Logan", "Jogger"]],
      ["Peugeot", ["301", "208", "308", "Partner"]],
      ["Citroën", ["C-Elysée", "Berlingo", "C3"]],
      ["Ford", ["Focus", "Transit Custom", "Courier", "Tourneo Connect"]],
      ["Opel", ["Astra", "Corsa", "Vectra", "Combo"]],
      ["Volkswagen", ["Passat", "Golf", "Polo", "Caddy", "Transporter"]],
      ["Hyundai", ["i20", "Accent Blue", "Tucson", "Bayon"]],
      ["Toyota", ["Corolla", "C-HR", "Yaris", "Hilux"]],
      ["Skoda", ["Octavia", "Superb", "Fabia"]],
      ["Togg", ["T10X", "T10F"]],
      ["Tofaş", ["Şahin", "Doğan", "Kartal", "Murat 131"]],
    ];
    for (const [make, models] of expected) {
      const res = await request(app)
        .get(`/api/catalog/models?make=${encodeURIComponent(make)}&type=car`)
        .set("Cookie", cookie);
      expect(res.status, make).toBe(200);
      for (const m of models) expect(res.body, `${make} → ${m}`).toContain(m);
    }
  });

  it("finds Citroën and Škoda through the spelling a keyboard produces", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    // norm() strips diacritics it has no Turkish rule for, so "Citroën" norms to
    // CITRON and "Škoda" to KODA. Someone typing the plain ASCII spelling must
    // still land on them — that is what the aliases are for.
    const c = await request(app).get("/api/catalog/models?make=CITROEN&type=car").set("Cookie", cookie);
    expect(c.body).toContain("Berlingo");
    const s = await request(app).get("/api/catalog/makes?q=skoda&type=car").set("Cookie", cookie);
    expect(s.body).toContain("Skoda");
  });

  it("resolves a make through its Turkish assembler name", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    // A ruhsat prints the local assembler, not the global brand.
    for (const [alias, model] of [
      ["TOFAS FIAT", "Egea"],
      ["OYAK RENAULT", "Clio"],
      ["FORD OTOSAN", "Transit"],
      ["HYUNDAI ASSAN", "i20"],
    ] as const) {
      const res = await request(app)
        .get(`/api/catalog/models?make=${encodeURIComponent(alias)}&type=car`)
        .set("Cookie", cookie);
      expect(res.body, alias).toContain(model);
    }
  });
});

/**
 * Minimising taps on the app's highest-traffic control. Opening a dropdown with
 * nothing typed must answer with what this market drives, not with the alphabet.
 */
describe("/api/catalog popularity ordering", () => {
  it("opens the car make list on the brands Turkey actually buys", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app).get("/api/catalog/makes?type=car").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.slice(0, 5)).toEqual(["Fiat", "Renault", "Volkswagen", "Ford", "Opel"]);
    // The old behaviour, and the thing this replaces.
    expect(res.body[0]).not.toBe("Alfa Romeo");
  });

  it("ranks motorcycle makes separately, so a car ranking cannot leak in", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app).get("/api/catalog/makes?type=motorcycle").set("Cookie", cookie);
    expect(res.body.slice(0, 4)).toEqual(["Honda", "Yamaha", "Suzuki", "Kawasaki"]);
    // Honda tops the motorcycle list; it must NOT therefore top the car list,
    // which is what a single shared popularity column would have done.
    const cars = await request(app).get("/api/catalog/makes?type=car").set("Cookie", cookie);
    expect(cars.body[0]).toBe("Fiat");
  });

  it("opens a make's model list on its common models", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const renault = await request(app)
      .get("/api/catalog/models?make=Renault&type=car")
      .set("Cookie", cookie);
    expect(renault.body.slice(0, 3)).toEqual(["Clio", "Megane", "Symbol"]);
    const fiat = await request(app).get("/api/catalog/models?make=Fiat&type=car").set("Cookie", cookie);
    expect(fiat.body[0]).toBe("Egea");
  });

  it("still lets match quality outrank popularity when something is typed", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    // "Seat" is far down the popularity list, but an exact hit still wins.
    const res = await request(app).get("/api/catalog/makes?q=seat&type=car").set("Cookie", cookie);
    expect(res.body[0]).toBe("Seat");
    // A prefix hit beats a more popular substring hit.
    const models = await request(app)
      .get("/api/catalog/models?make=Fiat&q=doblo&type=car")
      .set("Cookie", cookie);
    expect(models.body[0]).toBe("Doblo");
  });

  it("leaves uncurated makes ranked last rather than dropping them", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    // vPIC breadth still answers an exact query — popularity 0 sorts last, it
    // does not filter.
    const res = await request(app).get("/api/catalog/makes?q=dav").set("Cookie", cookie);
    expect(res.body.some((n: string) => /davidson/i.test(n))).toBe(true);
  });
});
