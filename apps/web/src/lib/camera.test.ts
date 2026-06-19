import { describe, it, expect } from "vitest";
import {
  fitGuideRect,
  mapRectToSource,
  laplacianVariance,
  meanLuma,
  assessQuality,
} from "./camera";

describe("fitGuideRect", () => {
  it("centers a width-constrained landscape rect inside a portrait box", () => {
    const r = fitGuideRect(400, 800, 1.5, { widthRatio: 0.92, heightRatio: 0.66 });
    expect(r.width).toBeCloseTo(368, 3);
    expect(r.height).toBeCloseTo(368 / 1.5, 3);
    expect(r.x).toBeCloseTo(16, 3);
    expect(r.y).toBeCloseTo((800 - 368 / 1.5) / 2, 3);
  });

  it("falls back to the height constraint when width would overflow it", () => {
    // Very wide box: width ratio would make the rect taller than heightRatio allows.
    const r = fitGuideRect(2000, 400, 1.5, { widthRatio: 0.92, heightRatio: 0.66 });
    expect(r.height).toBeCloseTo(400 * 0.66, 3);
    expect(r.width).toBeCloseTo(400 * 0.66 * 1.5, 3);
    expect(r.x).toBeCloseTo((2000 - 400 * 0.66 * 1.5) / 2, 3);
    expect(r.y).toBeCloseTo((400 - 400 * 0.66) / 2, 3);
  });
});

describe("mapRectToSource (object-fit: cover)", () => {
  it("maps a guide rect from box space to source pixels, accounting for horizontal overflow", () => {
    const box = { width: 400, height: 800 };
    const source = { width: 1080, height: 1920 };
    const rect = { x: 16, y: 277.333, width: 368, height: 245.333 };
    const crop = mapRectToSource(box, source, rect);
    // cover scale = max(400/1080, 800/1920) = 0.41666...
    const scale = Math.max(400 / 1080, 800 / 1920);
    const offsetX = (1080 * scale - 400) / 2;
    expect(crop.sx).toBeCloseTo((16 + offsetX) / scale, 2);
    expect(crop.sy).toBeCloseTo(277.333 / scale, 2);
    expect(crop.sw).toBeCloseTo(368 / scale, 2);
    expect(crop.sh).toBeCloseTo(245.333 / scale, 2);
  });

  it("clamps the crop to the source bounds", () => {
    const box = { width: 400, height: 800 };
    const source = { width: 1080, height: 1920 };
    const rect = { x: -50, y: -50, width: 5000, height: 5000 };
    const crop = mapRectToSource(box, source, rect);
    expect(crop.sx).toBeGreaterThanOrEqual(0);
    expect(crop.sy).toBeGreaterThanOrEqual(0);
    expect(crop.sx + crop.sw).toBeLessThanOrEqual(source.width + 0.001);
    expect(crop.sy + crop.sh).toBeLessThanOrEqual(source.height + 0.001);
  });
});

describe("laplacianVariance", () => {
  it("is zero for a uniform image", () => {
    const w = 16;
    const h = 16;
    const gray = new Uint8ClampedArray(w * h).fill(128);
    expect(laplacianVariance(gray, w, h)).toBe(0);
  });

  it("is large for a high-frequency checkerboard", () => {
    const w = 16;
    const h = 16;
    const gray = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) gray[y * w + x] = (x + y) % 2 === 0 ? 0 : 255;
    expect(laplacianVariance(gray, w, h)).toBeGreaterThan(1000);
  });
});

describe("meanLuma", () => {
  it("returns 255 for all-white and 0 for all-black RGBA", () => {
    const white = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]);
    const black = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]);
    expect(meanLuma(white)).toBeCloseTo(255, 1);
    expect(meanLuma(black)).toBeCloseTo(0, 1);
  });
});

describe("assessQuality", () => {
  const thresholds = { minSharpness: 60, minLuma: 40, maxLuma: 250 };

  it("passes a sharp, well-lit frame", () => {
    const q = assessQuality({ sharpness: 500, luma: 120 }, thresholds);
    expect(q.ok).toBe(true);
    expect(q.issues).toHaveLength(0);
  });

  it("flags a blurry frame", () => {
    const q = assessQuality({ sharpness: 10, luma: 120 }, thresholds);
    expect(q.ok).toBe(false);
    expect(q.issues).toContain("blurry");
  });

  it("flags a dark frame", () => {
    const q = assessQuality({ sharpness: 500, luma: 20 }, thresholds);
    expect(q.ok).toBe(false);
    expect(q.issues).toContain("dark");
  });

  it("flags a washed-out frame", () => {
    const q = assessQuality({ sharpness: 500, luma: 253 }, thresholds);
    expect(q.ok).toBe(false);
    expect(q.issues).toContain("glare");
  });
});
