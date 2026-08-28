import { describe, it, expect } from "vitest";
import { vehicleIcon, vehicleTint, tintGradient, vehiclePhotoSrc } from "./vehicleType";

describe("vehicleIcon", () => {
  it("picks the car glyph only for cars", () => {
    expect(vehicleIcon("car")).not.toBe(vehicleIcon("motorcycle"));
    // An unknown or absent type falls back to the app's original default.
    expect(vehicleIcon(null)).toBe(vehicleIcon("motorcycle"));
    expect(vehicleIcon(undefined)).toBe(vehicleIcon("motorcycle"));
  });
});

describe("vehicleTint", () => {
  it("derives the tint from the colour the owner recorded", () => {
    const red = vehicleTint({ id: "a", color: "Kırmızı" });
    const white = vehicleTint({ id: "b", color: "Beyaz" });
    expect(red).not.toEqual(white);
    // Same colour, different vehicles → the same tint. The tile means "red car",
    // not "vehicle #3".
    expect(vehicleTint({ id: "zzz", color: "Kırmızı" })).toEqual(red);
  });

  it("folds Turkish casing and diacritics", () => {
    const canonical = vehicleTint({ id: "a", color: "Kırmızı" });
    for (const spelling of ["KIRMIZI", "kırmızı", "Kirmizi", "  Kırmızı  "]) {
      expect(vehicleTint({ id: "a", color: spelling }), spelling).toEqual(canonical);
    }
    // Dotted-I folding is the one that bites: "Yeşil" uppercases to "YEŞİL".
    expect(vehicleTint({ id: "a", color: "YEŞİL" })).toEqual(vehicleTint({ id: "a", color: "Yeşil" }));
  });

  it("reads a compound colour the way a ruhsat writes one", () => {
    // Real records say "Beyaz Metalik", "GRİ METALİK", "Buz Mavisi" — the
    // recorded value contains a known colour rather than equalling one.
    expect(vehicleTint({ id: "a", color: "Beyaz Metalik" })).toEqual(
      vehicleTint({ id: "a", color: "Beyaz" }),
    );
    expect(vehicleTint({ id: "a", color: "GRİ METALİK" })).toEqual(
      vehicleTint({ id: "a", color: "Gri" }),
    );
  });

  it("understands English colour names too (CSV import, English transcription)", () => {
    expect(vehicleTint({ id: "a", color: "white" })).toEqual(vehicleTint({ id: "a", color: "Beyaz" }));
    expect(vehicleTint({ id: "a", color: "Black" })).toEqual(vehicleTint({ id: "a", color: "Siyah" }));
  });

  it("falls back to a stable per-vehicle tint when no colour is recorded", () => {
    const a = vehicleTint({ id: "01HXYZ", color: null });
    // Stable: the same vehicle must look identical on every render and reload.
    expect(vehicleTint({ id: "01HXYZ", color: null })).toEqual(a);
    // And distinct enough that a garage is not a wall of one colour.
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => vehicleTint({ id }).from);
    expect(new Set(ids).size).toBeGreaterThan(1);
  });

  it("still produces a tint for a record that has no id yet", () => {
    // A form preview, before the vehicle has been saved.
    const t = vehicleTint({ make: "Fiat", model: "Egea", nickname: "Kırmızı olan" });
    expect(t.from).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(t.to).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("always carries an ink that is legible on its own tint", () => {
    // The tile brings its own background, so it must bring its own contrast —
    // it cannot inherit the page's light/dark foreground.
    for (const color of ["Beyaz", "Siyah", "Sarı", "Lacivert", "Bej", null]) {
      const t = vehicleTint({ id: "x", color });
      expect(t.ink, String(color)).toMatch(/^rgba\(/);
    }
    // A near-white tint takes dark ink; a near-black one takes light ink.
    expect(vehicleTint({ id: "x", color: "Beyaz" }).ink).not.toBe(
      vehicleTint({ id: "x", color: "Siyah" }).ink,
    );
  });
});

describe("tintGradient", () => {
  it("renders both stops into one CSS value", () => {
    const g = tintGradient({ from: "#111111", to: "#222222", ink: "rgba(0,0,0,1)" });
    expect(g).toContain("#111111");
    expect(g).toContain("#222222");
    expect(g.startsWith("linear-gradient(")).toBe(true);
  });
});

describe("vehiclePhotoSrc", () => {
  it("is null when the vehicle has no photo", () => {
    expect(vehiclePhotoSrc(null, "https://api.test")).toBeNull();
    expect(vehiclePhotoSrc(undefined, "https://api.test", "thumb")).toBeNull();
  });

  it("keeps the cache-buster when asking for the thumbnail", () => {
    // `?v=<updated_at>` is what makes a replaced photo appear immediately; the
    // size parameter must be appended to it, never replace it.
    const url = vehiclePhotoSrc("/api/bikes/abc/photo?v=2026-01-01", "https://api.test", "thumb");
    expect(url).toBe("https://api.test/api/bikes/abc/photo?v=2026-01-01&size=thumb");
  });

  it("asks for the master by default", () => {
    expect(vehiclePhotoSrc("/api/bikes/abc/photo?v=1", "https://api.test")).toBe(
      "https://api.test/api/bikes/abc/photo?v=1",
    );
  });

  it("still forms a valid URL if the path ever loses its query", () => {
    expect(vehiclePhotoSrc("/api/bikes/abc/photo", "https://api.test", "thumb")).toBe(
      "https://api.test/api/bikes/abc/photo?size=thumb",
    );
  });
});
