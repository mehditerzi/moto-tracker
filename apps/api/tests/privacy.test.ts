import { describe, it, expect } from "vitest";
import { buildTestApp } from "./helpers/buildApp.js";
import request from "supertest";

async function policy(): Promise<string> {
  const res = await request(buildTestApp()).get("/privacy");
  expect(res.status).toBe(200);
  return res.text;
}

describe("/privacy", () => {
  it("serves the privacy policy as public HTML with no auth", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/privacy");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain("Privacy Policy");
    expect(res.text).toContain("mehditerzi32@hotmail.com");
  });

  it("stays self-contained: no script, no external asset, no login needed", async () => {
    const text = await policy();
    // App Review opens this URL logged out, from a browser we do not control.
    expect(text).not.toMatch(/<script/i);
    expect(text).not.toMatch(/src\s*=\s*["']https?:/i);
    expect(text).not.toMatch(/<link[^>]+stylesheet/i);
  });

  /**
   * The fleet layer put two new kinds of personal data in the product:
   * employees' GPS routes, readable by their managers, and renter records that
   * belong to a customer of ours rather than to a user. Neither may be left
   * undisclosed, so the disclosures are asserted rather than trusted.
   */
  describe("fleet disclosures", () => {
    it("discloses that a company vehicle's trips and routes are visible to management", async () => {
      const text = await policy();
      expect(text).toContain('id="organizations"');
      expect(text).toMatch(/employer can see where a company vehicle went/i);
      expect(text).toMatch(/including the route/i);
      // …and that a personal vehicle is not part of it.
      expect(text).toMatch(/company vehicles only/i);
    });

    it("states the controller/processor split for an organization's data", async () => {
      const text = await policy();
      expect(text).toMatch(/data controller/i);
      expect(text).toMatch(/veri sorumlusu/);
      expect(text).toMatch(/processor/i);
    });

    it("explains what an organization holds about its renters and how it is deleted", async () => {
      const text = await policy();
      expect(text).toContain('id="org-customers"');
      expect(text).toMatch(/rental contracts/i);
      expect(text).toMatch(/delete a customer/i);
    });

    it("explains what account deletion does and does not remove for an org member", async () => {
      const text = await policy();
      expect(text).toMatch(/stay with the organization/i);
      expect(text).toMatch(/last remaining member/i);
    });

    it("carries no fleet sales pitch — disclosure only", async () => {
      const text = await policy();
      // docs/fleet-design.md: no price, no acquisition path, anywhere a
      // consumer can reach. A privacy disclosure must not become one.
      expect(text).not.toMatch(/contact sales|upgrade to fleet|pricing|per vehicle\/month/i);
    });
  });

  /**
   * Sharing and handover put two more kinds of disclosure in the product, and
   * both of them are promises the code has to keep: what a person you share
   * with can see, and exactly what does and does not move when a vehicle
   * changes hands. The corresponding behaviour is asserted in
   * vehicleShares.test.ts and vehicleHandover.test.ts; these tests assert that
   * the policy still SAYS it.
   */
  describe("sharing and handover disclosures", () => {
    it("states what each sharing level can see, and what a guest cannot", async () => {
      const text = await policy();
      expect(text).toContain('id="sharing"');
      expect(text).toMatch(/guest/i);
      expect(text).toMatch(/member/i);
      // The guest boundary, in the policy's own words.
      expect(text).toMatch(/cannot<\/strong> see your trips/i);
      // And the member disclosure, which is the one people need to read twice.
      expect(text).toMatch(/plus the trips[\s\S]{0,60}recorded on those vehicles/i);
    });

    it("explains the duplicate check without promising to identify the holder", async () => {
      const text = await policy();
      expect(text).toMatch(/already tracked/i);
      expect(text).toMatch(/nothing else<\/strong>/i);
      // And says plainly why a plate is not used as the key.
      expect(text).toMatch(/not<\/strong> match on plate numbers/i);
    });

    it("lists exactly what a handover transfers and what it does not", async () => {
      const text = await policy();
      expect(text).toContain('id="handover"');
      expect(text).toMatch(/Transfers to the new owner/i);
      expect(text).toMatch(/Stays with the previous owner/i);
      // The four that must never move.
      for (const kept of [/GPS trips/i, /fuel purchases/i, /every document they scanned/i, /photos they took/i]) {
        expect(text).toMatch(kept);
      }
      // The reason, stated rather than implied.
      expect(text).toMatch(/kimlik number/i);
    });

    it("says there is no automatic transfer", async () => {
      const text = await policy();
      expect(text).toMatch(/current holder agrees/i);
      expect(text).toMatch(/no automatic transfer/i);
    });
  });
});
