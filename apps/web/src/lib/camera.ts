/**
 * Camera helpers for the in-app document scanner.
 *
 * The pure geometry/quality functions (fitGuideRect, mapRectToSource,
 * laplacianVariance, meanLuma, assessQuality) are kept free of DOM/canvas types
 * so they can be unit-tested in plain Node and reused in any context.
 *
 * `downscaleImageFile` at the bottom is DOM-dependent (canvas + Image) and must
 * only be called in a browser/WebView environment.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface SourceCrop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Compute the centered capture guide rectangle for a viewport `box`, given the
 * target document `aspect` (width / height). The rect is as large as the width
 * allows, then clamped so it never exceeds `heightRatio` of the box height —
 * this keeps room for the hint text and shutter controls.
 */
export function fitGuideRect(
  boxWidth: number,
  boxHeight: number,
  aspect: number,
  opts: { widthRatio?: number; heightRatio?: number } = {},
): Rect {
  const widthRatio = opts.widthRatio ?? 0.92;
  const heightRatio = opts.heightRatio ?? 0.66;

  let width = boxWidth * widthRatio;
  let height = width / aspect;
  const maxHeight = boxHeight * heightRatio;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspect;
  }
  return {
    x: (boxWidth - width) / 2,
    y: (boxHeight - height) / 2,
    width,
    height,
  };
}

/**
 * Map a rectangle expressed in displayed-box coordinates back to source-pixel
 * coordinates, inverting the `object-fit: cover` transform used to paint the
 * camera stream. Result is clamped to the source bounds so a generous guide
 * rect never reads outside the frame.
 */
export function mapRectToSource(box: Size, source: Size, rect: Rect): SourceCrop {
  const scale = Math.max(box.width / source.width, box.height / source.height);
  const displayedWidth = source.width * scale;
  const displayedHeight = source.height * scale;
  const offsetX = (displayedWidth - box.width) / 2;
  const offsetY = (displayedHeight - box.height) / 2;

  let sx = (rect.x + offsetX) / scale;
  let sy = (rect.y + offsetY) / scale;
  let sw = rect.width / scale;
  let sh = rect.height / scale;

  // Clamp to source bounds.
  if (sx < 0) {
    sw += sx;
    sx = 0;
  }
  if (sy < 0) {
    sh += sy;
    sy = 0;
  }
  if (sx + sw > source.width) sw = source.width - sx;
  if (sy + sh > source.height) sh = source.height - sy;

  return { sx, sy, sw, sh };
}

/**
 * Variance of the 4-neighbour Laplacian over a single-channel image — a
 * standard, cheap focus measure. Higher means more high-frequency detail
 * (sharper); a uniform/blurry frame trends toward zero.
 */
export function laplacianVariance(gray: Uint8ClampedArray, width: number, height: number): number {
  const lap: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const value =
        4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - width]! - gray[i + width]!;
      lap.push(value);
    }
  }
  if (lap.length === 0) return 0;
  const mean = lap.reduce((a, b) => a + b, 0) / lap.length;
  const variance = lap.reduce((a, b) => a + (b - mean) * (b - mean), 0) / lap.length;
  return variance;
}

/** Mean Rec. 601 luma (0–255) of an RGBA buffer. */
export function meanLuma(rgba: Uint8ClampedArray): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    sum += 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;
    count++;
  }
  return count === 0 ? 0 : sum / count;
}

export interface QualityThresholds {
  minSharpness: number;
  minLuma: number;
  maxLuma: number;
}

export type QualityIssue = "blurry" | "dark" | "glare";

export interface QualityResult {
  ok: boolean;
  issues: QualityIssue[];
}

/** Turn raw sharpness/luma measurements into a pass/fail with named issues. */
export function assessQuality(
  metrics: { sharpness: number; luma: number },
  thresholds: QualityThresholds,
): QualityResult {
  const issues: QualityIssue[] = [];
  if (metrics.sharpness < thresholds.minSharpness) issues.push("blurry");
  if (metrics.luma < thresholds.minLuma) issues.push("dark");
  if (metrics.luma > thresholds.maxLuma) issues.push("glare");
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// DOM-dependent helpers (browser/WebView only)
// ---------------------------------------------------------------------------

/**
 * Downscale an image File so its longest edge does not exceed `maxEdge` pixels.
 * Returns the original File unchanged when it already fits within bounds.
 *
 * Uses HTMLImageElement + canvas — only call this in a browser/WebView context.
 * Non-JPEG source types are re-encoded as JPEG (quality 0.92); PNG is kept as PNG.
 * Falls back to the original File if the canvas context is unavailable or if the
 * image cannot be decoded (e.g. unsupported format in a given browser).
 */
export function downscaleImageFile(file: File, maxEdge: number): Promise<File> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
      if (longEdge <= maxEdge) {
        resolve(file);
        return;
      }
      const k = maxEdge / longEdge;
      const outW = Math.max(1, Math.round(img.naturalWidth * k));
      const outH = Math.max(1, Math.round(img.naturalHeight * k));
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, outW, outH);
      const outType = file.type === "image/png" ? "image/png" : "image/jpeg";
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const ext = outType === "image/png" ? "png" : "jpg";
          const baseName = file.name.replace(/\.[^.]+$/, "");
          resolve(new File([blob], `${baseName}-scaled.${ext}`, { type: outType }));
        },
        outType,
        0.92,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      // Can't decode (e.g. HEIC on a non-Safari browser) — upload as-is.
      resolve(file);
    };
    img.src = url;
  });
}
