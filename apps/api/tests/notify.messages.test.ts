import { describe, it, expect } from "vitest";
import {
  asLang,
  maintenanceLabel,
  notificationTitle,
  typeLabel,
} from "../src/notify/messages.js";

describe("notify messages", () => {
  it("falls back to Turkish for an unknown/absent language", () => {
    expect(asLang(undefined)).toBe("tr");
    expect(asLang("de")).toBe("tr");
    expect(asLang("en")).toBe("en");
  });

  it("translates the dated-item type labels", () => {
    expect(typeLabel("tr", "sigorta")).toBe("Sigorta");
    expect(typeLabel("en", "sigorta")).toBe("Insurance");
    expect(typeLabel("tr", "muayene")).toBe("Muayene");
    expect(typeLabel("en", "muayene")).toBe("Inspection");
    expect(typeLabel("tr", "mtv")).toBe("MTV");
    expect(typeLabel("en", "mtv")).toBe("Vehicle tax");
    expect(typeLabel("tr", "maintenance")).toBe("Bakım");
    expect(typeLabel("en", "maintenance")).toBe("Maintenance");
    expect(typeLabel("tr", "kasko")).toBe("Kasko");
  });

  it("falls back to a generic title for an unknown type", () => {
    expect(typeLabel("tr", "nope")).toBe("Bildirim");
    expect(typeLabel("en", "nope")).toBe("Reminder");
  });

  it("translates maintenance kinds and keeps custom labels verbatim", () => {
    expect(maintenanceLabel("tr", "engine_oil", null)).toBe("Motor yağı");
    expect(maintenanceLabel("en", "engine_oil", null)).toBe("Engine oil");
    expect(maintenanceLabel("en", "air_filter", null)).toBe("Air filter");
    // A custom item is the user's own wording — never translated.
    expect(maintenanceLabel("en", "custom", "Zincir yağı")).toBe("Zincir yağı");
    expect(maintenanceLabel("tr", "custom", null)).toBe("Bakım");
    expect(maintenanceLabel("en", "custom", "  ")).toBe("Maintenance");
    expect(maintenanceLabel("en", null, null)).toBe("Maintenance");
  });

  it("builds a whole sentence per language, with the right word order", () => {
    expect(notificationTitle("tr", "Sigorta", 0)).toBe("Sigorta bugün bitiyor");
    expect(notificationTitle("tr", "Sigorta", 1)).toBe("Sigorta 1 gün sonra bitiyor");
    expect(notificationTitle("tr", "Sigorta", 30)).toBe("Sigorta 30 gün sonra bitiyor");
    expect(notificationTitle("en", "Insurance", 0)).toBe("Insurance expires today");
    expect(notificationTitle("en", "Insurance", 30)).toBe("Insurance expires in 30 days");
  });

  it("pluralises the English day count", () => {
    expect(notificationTitle("en", "Insurance", 1)).toBe("Insurance expires in 1 day");
    expect(notificationTitle("en", "Insurance", 2)).toBe("Insurance expires in 2 days");
    // Turkish has no plural marker after a numeral.
    expect(notificationTitle("tr", "Sigorta", 2)).toBe("Sigorta 2 gün sonra bitiyor");
  });
});
