import type { LatLng } from "@/lib/polyline";
import { vehicleArtFor } from "@/lib/vehicleArt";
import type { VehicleType } from "@mototracker/shared";

/**
 * SHARE CARDS — the Strava moment: a ride, a month or a planned group ride as
 * an image made for an Instagram story or a WhatsApp status. Drawn on a canvas
 * on the phone: nothing is uploaded, the route never leaves the device unless
 * the user shares the picture themselves.
 */

export type CardFormat = "story" | "post";
export const CARD_SIZE: Record<CardFormat, { w: number; h: number }> = {
  story: { w: 1080, h: 1920 },
  post: { w: 1080, h: 1350 },
};

export interface CardVehicle {
  id?: string | null;
  vehicleType?: VehicleType | null;
  nickname?: string | null;
  make?: string | null;
  model?: string | null;
  color?: string | null;
  cylinderCc?: number | null;
}

export interface CardStat {
  label: string;
  value: string;
  unit?: string;
}

export type CardData =
  | {
      kind: "trip";
      eyebrow: string;
      title: string;
      date: string;
      hero: CardStat;
      stats: CardStat[];
      route: LatLng[] | null;
      vehicle: CardVehicle | null;
    }
  | {
      kind: "summary";
      eyebrow: string;
      title: string;
      hero: CardStat;
      stats: CardStat[];
      vehicle: CardVehicle | null;
      /** Optional little bar chart: one value per bucket (e.g. week or month). */
      bars?: { label: string; value: number }[];
    }
  | {
      kind: "ride";
      eyebrow: string;
      title: string;
      lines: { icon: "when" | "meet" | "dest" | "people"; text: string }[];
      code: string;
      cta: string;
      vehicle: CardVehicle | null;
    };

const INK = "#F4F4F5";
const MUTED = "rgba(244,244,245,0.55)";
const LIME = "#E1FF4D";
const BG = "#0B0B0E";
const FONT = '"Geist Variable", Geist, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

const font = (weight: number, px: number) => `${weight} ${px}px ${FONT}`;

async function ensureFonts(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load(font(700, 64)),
      document.fonts.load(font(500, 32)),
      document.fonts.load(font(800, 200)),
    ]);
  } catch {
    /* system font is fine */
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function vehicleImage(v: CardVehicle | null): Promise<HTMLImageElement | null> {
  if (!v) return null;
  const svg = vehicleArtFor(v).svg;
  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

function background(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  // A lime glow from the top — the brand's one accent — and a cool one low.
  const g1 = ctx.createRadialGradient(w * 0.15, -h * 0.05, 0, w * 0.15, -h * 0.05, w * 1.1);
  g1.addColorStop(0, "rgba(225,255,77,0.20)");
  g1.addColorStop(1, "rgba(225,255,77,0)");
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, w, h);
  const g2 = ctx.createRadialGradient(w * 0.9, h * 1.05, 0, w * 0.9, h * 1.05, w);
  g2.addColorStop(0, "rgba(77,140,255,0.16)");
  g2.addColorStop(1, "rgba(77,140,255,0)");
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, w, h);
  // Fine topographic-ish grid so a route has ground to sit on.
  ctx.strokeStyle = "rgba(255,255,255,0.035)";
  ctx.lineWidth = 2;
  for (let x = 60; x < w; x += 120) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 60; y < h; y += 120) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function brand(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // The mark: a lime rounded square with a G.
  ctx.fillStyle = LIME;
  roundRect(ctx, x, y - 44, 56, 56, 16);
  ctx.fill();
  ctx.fillStyle = BG;
  ctx.font = font(800, 36);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("G", x + 28, y - 15);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK;
  ctx.font = font(700, 34);
  ctx.fillText("Garajım", x + 74, y);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Shrink the font until `text` fits `maxW`. */
function fitText(ctx: CanvasRenderingContext2D, text: string, weight: number, px: number, maxW: number): number {
  let size = px;
  ctx.font = font(weight, size);
  while (size > 24 && ctx.measureText(text).width > maxW) {
    size -= 4;
    ctx.font = font(weight, size);
  }
  return size;
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

/** Project lat/lng into a box, keeping the aspect (equirectangular × cos φ). */
function projectRoute(route: LatLng[], box: { x: number; y: number; w: number; h: number }): [number, number][] {
  const lat0 = route.reduce((s, p) => s + p[0], 0) / route.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const pts = route.map(([lat, lng]) => [lng * k, -lat] as [number, number]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1e-6), spanY = Math.max(maxY - minY, 1e-6);
  const s = Math.min(box.w / spanX, box.h / spanY);
  const ox = box.x + (box.w - spanX * s) / 2;
  const oy = box.y + (box.h - spanY * s) / 2;
  return pts.map(([x, y]) => [ox + (x - minX) * s, oy + (y - minY) * s]);
}

function drawRoute(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  const path = () => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  };
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.save();
  ctx.shadowColor = "rgba(225,255,77,0.65)";
  ctx.shadowBlur = 40;
  ctx.strokeStyle = "rgba(225,255,77,0.55)";
  ctx.lineWidth = 22;
  path();
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = LIME;
  ctx.lineWidth = 11;
  path();
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.65)";
  ctx.lineWidth = 3;
  path();
  ctx.stroke();
  const dot = ([x, y]: [number, number], fill: string) => {
    ctx.beginPath();
    ctx.arc(x, y, 17, 0, Math.PI * 2);
    ctx.fillStyle = BG;
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = fill;
    ctx.stroke();
  };
  dot(pts[0]!, "#ffffff");
  dot(pts[pts.length - 1]!, LIME);
}

function drawStat(ctx: CanvasRenderingContext2D, s: CardStat, x: number, y: number, valuePx: number, maxW: number) {
  ctx.fillStyle = MUTED;
  ctx.font = font(600, 28);
  ctx.fillText(s.label.toLocaleUpperCase("tr-TR"), x, y);
  ctx.fillStyle = INK;
  const size = fitText(ctx, s.value, 700, valuePx, maxW - (s.unit ? 80 : 0));
  ctx.fillText(s.value, x, y + size + 6);
  if (s.unit) {
    const vw = ctx.measureText(s.value).width;
    ctx.fillStyle = MUTED;
    ctx.font = font(600, Math.round(size * 0.42));
    ctx.fillText(s.unit, x + vw + 12, y + size + 6);
  }
}

function drawHero(ctx: CanvasRenderingContext2D, s: CardStat, x: number, y: number, w: number) {
  ctx.fillStyle = LIME;
  ctx.font = font(700, 30);
  ctx.fillText(s.label.toLocaleUpperCase("tr-TR"), x, y);
  const size = fitText(ctx, s.value, 800, 220, w - 160);
  ctx.fillStyle = INK;
  ctx.fillText(s.value, x - 6, y + size * 0.92);
  if (s.unit) {
    const vw = ctx.measureText(s.value).width;
    ctx.font = font(700, Math.round(size * 0.32));
    ctx.fillStyle = MUTED;
    ctx.fillText(s.unit, x + vw + 10, y + size * 0.92);
  }
  return y + size * 0.92;
}

function drawVehicleFooter(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  v: CardVehicle | null,
  w: number,
  h: number,
  pad: number,
) {
  if (!v) return;
  const iw = 300, ih = 150;
  const y = h - pad - ih + 18;
  if (img) ctx.drawImage(img, w - pad - iw + 20, y, iw, ih);
  ctx.fillStyle = INK;
  ctx.font = font(700, 38);
  const name = ellipsize(ctx, v.nickname || [v.make, v.model].filter(Boolean).join(" ") || "", w - pad * 2 - iw);
  ctx.fillText(name, pad, h - pad - 50);
  ctx.fillStyle = MUTED;
  ctx.font = font(500, 28);
  const sub = [v.make, v.model].filter(Boolean).join(" ");
  if (sub && sub !== name) ctx.fillText(ellipsize(ctx, sub, w - pad * 2 - iw), pad, h - pad - 8);
}

export async function renderShareCard(data: CardData, format: CardFormat): Promise<Blob> {
  await ensureFonts();
  const { w, h } = CARD_SIZE[format];
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const pad = 84;
  const story = format === "story";
  background(ctx, w, h);
  const top = story ? 150 : 110;
  brand(ctx, pad, top);
  ctx.textAlign = "left";

  const img = await vehicleImage(data.vehicle);

  // Eyebrow + title.
  ctx.fillStyle = LIME;
  ctx.font = font(700, 30);
  ctx.fillText(data.eyebrow.toLocaleUpperCase("tr-TR"), pad, top + (story ? 120 : 92));
  ctx.fillStyle = INK;
  const titleSize = fitText(ctx, data.title, 700, story ? 76 : 64, w - pad * 2);
  ctx.fillText(ellipsize(ctx, data.title, w - pad * 2), pad, top + (story ? 120 : 92) + titleSize + 12);
  let cursor = top + (story ? 120 : 92) + titleSize + 12;

  if (data.kind === "trip") {
    ctx.fillStyle = MUTED;
    ctx.font = font(500, 30);
    ctx.fillText(data.date, pad, cursor + 52);
    cursor += 52;
    const statsH = story ? 470 : 380;
    const footerH = data.vehicle ? 190 : 40;
    const box = { x: pad + 20, y: cursor + 60, w: w - pad * 2 - 40, h: h - cursor - 60 - statsH - footerH };
    if (data.route && data.route.length > 1) {
      drawRoute(ctx, projectRoute(data.route, box));
    } else if (img) {
      const iw = Math.min(box.w, box.h * 2);
      ctx.drawImage(img, box.x + (box.w - iw) / 2, box.y + (box.h - iw / 2) / 2, iw, iw / 2);
    }
    let y = box.y + box.h + 70;
    y = drawHero(ctx, data.hero, pad, y, w - pad * 2);
    const colW = (w - pad * 2) / Math.max(1, data.stats.length);
    data.stats.forEach((s, i) => drawStat(ctx, s, pad + i * colW, y + 80, story ? 72 : 60, colW - 20));
    drawVehicleFooter(ctx, img, data.vehicle, w, h, pad);
  } else if (data.kind === "summary") {
    let y = cursor + (story ? 150 : 90);
    y = drawHero(ctx, data.hero, pad, y, w - pad * 2);
    // Stats in a 2-column grid.
    const colW = (w - pad * 2) / 2;
    data.stats.forEach((s, i) => {
      const cx = pad + (i % 2) * colW;
      const cy = y + 90 + Math.floor(i / 2) * (story ? 190 : 160);
      drawStat(ctx, s, cx, cy, story ? 80 : 64, colW - 24);
    });
    const rows = Math.ceil(data.stats.length / 2);
    y = y + 90 + rows * (story ? 190 : 160);
    if (data.bars && data.bars.length > 1 && story) {
      const max = Math.max(...data.bars.map((b) => b.value), 1);
      const bh = 220, bw = (w - pad * 2) / data.bars.length;
      data.bars.forEach((b, i) => {
        const hgt = Math.max(6, (b.value / max) * bh);
        ctx.fillStyle = i === data.bars!.length - 1 ? LIME : "rgba(244,244,245,0.18)";
        roundRect(ctx, pad + i * bw + 8, y + bh - hgt + 20, bw - 16, hgt, 10);
        ctx.fill();
        ctx.fillStyle = MUTED;
        ctx.font = font(600, 22);
        ctx.textAlign = "center";
        ctx.fillText(b.label, pad + i * bw + bw / 2, y + bh + 60);
        ctx.textAlign = "left";
      });
    } else if (img && story) {
      ctx.drawImage(img, (w - 760) / 2, y + 10, 760, 380);
    }
    drawVehicleFooter(ctx, story && !(data.bars && data.bars.length > 1) ? null : img, data.vehicle, w, h, pad);
  } else {
    // Planned group ride: the invitation as a poster.
    let y = cursor + 80;
    const icons: Record<string, string> = { when: "◷", meet: "◉", dest: "⚑", people: "●●" };
    for (const line of data.lines) {
      ctx.fillStyle = LIME;
      ctx.font = font(700, 34);
      ctx.fillText(icons[line.icon] ?? "•", pad, y);
      ctx.fillStyle = INK;
      ctx.font = font(600, story ? 44 : 38);
      ctx.fillText(ellipsize(ctx, line.text, w - pad * 2 - 70), pad + 70, y);
      y += story ? 86 : 72;
    }
    if (img) {
      const iw = story ? 860 : 620;
      ctx.drawImage(img, (w - iw) / 2, y + (story ? 40 : 0), iw, iw / 2);
      y += iw / 2 + (story ? 40 : 0);
    }
    // Code chip + call to action.
    const chipY = h - pad - (story ? 260 : 200);
    ctx.fillStyle = "rgba(225,255,77,0.12)";
    roundRect(ctx, pad, chipY, w - pad * 2, story ? 200 : 160, 36);
    ctx.fill();
    ctx.strokeStyle = "rgba(225,255,77,0.45)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.font = font(600, 28);
    ctx.fillText(data.cta.toLocaleUpperCase("tr-TR"), pad + 44, chipY + 62);
    ctx.fillStyle = LIME;
    ctx.font = font(800, story ? 84 : 70);
    ctx.fillText(data.code.split("").join(" "), pad + 40, chipY + (story ? 160 : 130));
  }

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("render_failed"))), "image/png"),
  );
}
