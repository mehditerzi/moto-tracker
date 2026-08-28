import { describe, it, expect } from "vitest";
import tr from "@/locales/tr.json";
import en from "@/locales/en.json";
import fleetTr from "@/locales/fleet.tr.json";
import fleetEn from "@/locales/fleet.en.json";

// Regression guard: tr.json and en.json must expose the identical set of keys.
// A key present in only one locale renders the raw key path to users in the
// other language. This also covers strings that were previously hardcoded in
// TR inside SettingsPage/InstallBanner (settings.vapidNotConfigured,
// settings.testFailed, common.dismiss) now sourced from the locale files.
function flatKeys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    out.push(...flatKeys(v, key));
  }
  return out;
}

describe("locale key parity", () => {
  const trKeys = new Set(flatKeys(tr));
  const enKeys = new Set(flatKeys(en));

  it("has no keys present in tr but missing in en", () => {
    const missing = [...trKeys].filter((k) => !enKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("has no keys present in en but missing in tr", () => {
    const missing = [...enKeys].filter((k) => !trKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("includes the de-hardcoded settings/common keys in both locales", () => {
    for (const key of [
      "settings.vapidNotConfigured",
      "settings.testFailed",
      "common.dismiss",
    ]) {
      expect(trKeys.has(key)).toBe(true);
      expect(enKeys.has(key)).toBe(true);
    }
  });

  it("includes the onboarding keys in both locales", () => {
    for (const key of [
      "onboarding.skip",
      "onboarding.next",
      "onboarding.getStarted",
      "onboarding.slides.scan.title",
      "onboarding.slides.scan.body",
      "onboarding.slides.remind.title",
      "onboarding.slides.remind.body",
      "onboarding.slides.garage.title",
      "onboarding.slides.garage.body",
    ]) {
      expect(trKeys.has(key)).toBe(true);
      expect(enKeys.has(key)).toBe(true);
    }
  });

  it("includes settings.daysBeforeShort in both locales", () => {
    expect(trKeys.has("settings.daysBeforeShort")).toBe(true);
    expect(enKeys.has("settings.daysBeforeShort")).toBe(true);
  });

  /**
   * Sharing is a CONSUMER feature, so its vocabulary belongs in the always-loaded
   * bundle rather than the lazy fleet chunk — and every string in it is a
   * disclosure of what another person will be able to see, which must never
   * render as a raw key path in either language.
   */
  it("keeps the sharing vocabulary in the main bundle, in both languages", () => {
    for (const key of [
      "share.sectionTitle",
      "share.role.guest.title",
      "share.role.guest.body",
      "share.role.member.title",
      "share.role.member.body",
      "share.duplicateTitle",
      "share.duplicateBodyChassis",
      "share.duplicateBodyEngine",
      "share.choiceAccessTitle",
      "share.choicePurchaseTitle",
      "share.claimDisclosure",
      "share.handoverTransfers",
      "share.handoverKeeps",
      "share.handoverConfirmBody",
      "share.decideIgnoreNote",
      "share.inviteLinkWarning",
    ]) {
      expect(trKeys.has(key), `tr is missing ${key}`).toBe(true);
      expect(enKeys.has(key), `en is missing ${key}`).toBe(true);
    }
  });

  /**
   * The duplicate screen must not name the holder, and the copy is where such a
   * sentence would realistically creep back in — "ask <name>", "owned by", an
   * email placeholder. Guard the words rather than trusting a code review.
   */
  it("never promises to identify who holds a duplicate vehicle", () => {
    const strings = (obj: unknown, path = ""): [string, string][] => {
      if (typeof obj === "string") return [[path, obj]];
      if (obj === null || typeof obj !== "object") return [];
      return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
        strings(v, path ? `${path}.${k}` : k),
      );
    };
    const dupCopy = [...strings(tr), ...strings(en)].filter(([k]) =>
      /^share\.(duplicate|choice|claimSent|claimWaiting|claimUnanswered)/.test(k),
    );
    expect(dupCopy.length).toBeGreaterThan(0);
    // The realistic regression is INTERPOLATING an identity into this copy —
    // "ask {{ownerName}}", "owned by ahmet@…" — not the ordinary phrase
    // "if the previous owner agrees", which is both true and necessary.
    const namesTheHolder =
      /\{\{holder|\{\{owner|\{\{email|\{\{plate|\{\{nickname|\bowned by\b|\bthe owner is\b|sahibi:\s|sahibi \{\{/i;
    expect(dupCopy.filter(([, v]) => namesTheHolder.test(v))).toEqual([]);
  });

  it("includes settings.updateFailed in both locales", () => {
    expect(trKeys.has("settings.updateFailed")).toBe(true);
    expect(enKeys.has("settings.updateFailed")).toBe(true);
  });

  // The driver-facing half of the fleet vocabulary stays in the always-loaded
  // bundle: it renders on a consumer dashboard (the company-vehicle marker and
  // the standing monitoring notice) and is a legal disclosure, so it must never
  // arrive late or be lazily registered.
  it("keeps the driver-facing fleet disclosure strings in the main bundle", () => {
    for (const key of [
      "nav.fleet",
      "fleet.orgVehicle.label",
      "fleet.orgVehicle.tooltip",
      "fleet.notice.summary",
      "fleet.notice.more",
      "fleet.limits.thisVehicle",
      "fleet.limits.whileAssigned",
      "fleet.limits.neverPersonal",
      "fleet.policyLink",
    ]) {
      expect(trKeys.has(key), `tr is missing ${key}`).toBe(true);
      expect(enKeys.has(key), `en is missing ${key}`).toBe(true);
    }
  });
});

// The manager-facing fleet vocabulary is loaded on demand (lib/fleetLocale.ts)
// so it never reaches a consumer's entry bundle, but it needs exactly the same
// parity guarantee — a key in only one file renders a raw key path to a fleet
// user in the other language.
describe("fleet locale key parity", () => {
  const trKeys = new Set(flatKeys(fleetTr));
  const enKeys = new Set(flatKeys(fleetEn));

  it("has no keys present in fleet.tr but missing in fleet.en", () => {
    expect([...trKeys].filter((k) => !enKeys.has(k))).toEqual([]);
  });

  it("has no keys present in fleet.en but missing in fleet.tr", () => {
    expect([...enKeys].filter((k) => !trKeys.has(k))).toEqual([]);
  });

  it("carries the org-garage copy for the vehicle form", () => {
    // The banner naming the target garage, and the two ceiling messages. They
    // are manager-facing, so they belong here and not in the entry bundle a
    // consumer downloads.
    for (const key of [
      "fleet.vehicles.add",
      "fleet.vehicles.limitReached",
      "fleet.newVehicle.title",
      "fleet.newVehicle.garageLabel",
      "fleet.newVehicle.garageNote",
      "fleet.newVehicle.submit",
      "fleet.newVehicle.added",
      "fleet.newVehicle.limitReached",
    ]) {
      expect(trKeys.has(key), `fleet.tr is missing ${key}`).toBe(true);
      expect(enKeys.has(key), `fleet.en is missing ${key}`).toBe(true);
    }
  });

  // App Store Guideline 3.1.1: no button, link or call to action pointing at a
  // purchasing mechanism other than IAP — in the app OR its metadata. An org's
  // vehicle allowance is sold offline, so the copy that reports the ceiling may
  // say it is full and who raises it, and nothing else. This guards the copy
  // itself, which is where such a sentence would realistically creep back in.
  it("offers no way to buy fleet capacity when a ceiling is reached", () => {
    const strings = (obj: unknown, path = ""): [string, string][] => {
      if (typeof obj === "string") return [[path, obj]];
      if (obj === null || typeof obj !== "object") return [];
      return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
        strings(v, path ? `${path}.${k}` : k),
      );
    };
    // Every string shown when an organization is at (or would exceed) its
    // vehicle allowance — the vehicle form, the inventory action and the CSV
    // import. Elsewhere in the fleet vocabulary "₺" is legitimate: the cost
    // screens are denominated in it.
    const ceilingCopy = [...strings(fleetTr), ...strings(fleetEn)].filter(([k]) =>
      /limitReached|blockedLimit|newVehicle\./.test(k),
    );
    expect(ceilingCopy.length).toBeGreaterThan(0);
    const forbidden =
      /(₺|\$|€|https?:|\bwww\.|abonelik|abone ol|satın al|ödeme|fiyat|planı? yükselt|upgrade|subscribe|subscription|purchase|pricing|\bbuy\b|checkout)/i;
    expect(ceilingCopy.filter(([, v]) => forbidden.test(v))).toEqual([]);
  });

  it("does not redefine anything the main bundle already owns", () => {
    // A duplicated key would be two sources of truth for one string, and the
    // deep merge in ensureFleetLocale() would silently pick the lazy one.
    const main = new Set([...flatKeys(tr), ...flatKeys(en)]);
    const overlap = [...trKeys, ...enKeys].filter((k) => main.has(k));
    expect(overlap).toEqual([]);
  });
});
