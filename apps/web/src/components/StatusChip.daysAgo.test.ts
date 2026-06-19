import { describe, it, expect, beforeAll } from "vitest";
import i18next from "i18next";
import tr from "@/locales/tr.json";
import en from "@/locales/en.json";

// Regression guard for the expired-state footer in StatusChip, which renders
// `t("items.daysAgo", { count })`. The footer used to show only the first word
// of `items.daysLeft` (e.g. "30 gün" / "30 days"), dropping the "önce"/"ago"
// suffix and reading like an upcoming date instead of an expired one.
describe("items.daysAgo translation contract", () => {
  beforeAll(async () => {
    await i18next.init({
      lng: "tr",
      fallbackLng: "tr",
      resources: { tr: { translation: tr }, en: { translation: en } },
      interpolation: { escapeValue: false },
    });
  });

  it("renders the full 'X gün önce' phrase in Turkish", async () => {
    await i18next.changeLanguage("tr");
    expect(i18next.t("items.daysAgo", { count: 30 })).toBe("30 gün önce");
    expect(i18next.t("items.daysAgo", { count: 1 })).toBe("1 gün önce");
  });

  it("renders the full 'X day(s) ago' phrase in English", async () => {
    await i18next.changeLanguage("en");
    expect(i18next.t("items.daysAgo", { count: 30 })).toBe("30 days ago");
    expect(i18next.t("items.daysAgo", { count: 1 })).toBe("1 day ago");
  });
});
