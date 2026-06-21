import { describe, it, expect } from "vitest";
import tr from "@/locales/tr.json";
import en from "@/locales/en.json";

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
});
