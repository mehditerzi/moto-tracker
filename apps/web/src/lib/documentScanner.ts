import { Capacitor, registerPlugin } from "@capacitor/core";

/** One recognised line from Apple Vision: text + unit box, top-left origin. */
export interface ScanLine {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScannedPage {
  file: File;
  lines: ScanLine[];
  ms: number;
}

interface DocumentScannerPlugin {
  scan(): Promise<{
    cancelled: boolean;
    pages: { image: string; width: number; height: number; ms: number; lines: ScanLine[] }[];
  }>;
}

const plugin = registerPlugin<DocumentScannerPlugin>("DocumentScanner");

/**
 * Is the system document scanner in this binary? Builds before 1.4 do not have
 * it, and the web app reaches them too — they keep the in-page camera.
 */
export function scannerAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("DocumentScanner");
}

function base64ToFile(b64: string, name: string): File {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: "image/jpeg" });
}

/**
 * Open the iOS document scanner: edge detection, auto-shutter, perspective
 * correction, as many cards in a row as the user likes. Each page comes back
 * already read on the phone. Empty array = the user cancelled.
 */
export async function scanDocuments(): Promise<ScannedPage[]> {
  const res = await plugin.scan();
  if (res.cancelled) return [];
  return res.pages.map((p, i) => ({
    file: base64ToFile(p.image, `scan-${Date.now()}-${i + 1}.jpg`),
    lines: p.lines,
    ms: p.ms,
  }));
}
