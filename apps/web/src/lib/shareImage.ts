import { Capacitor, registerPlugin } from "@capacitor/core";

interface ShareImagePlugin {
  share(opts: { image: string; text?: string; url?: string }): Promise<{ completed: boolean; activity?: string }>;
}

const plugin = registerPlugin<ShareImagePlugin>("ShareImage");

export type ShareOutcome = "shared" | "dismissed" | "downloaded" | "unsupported";

function nativeAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("ShareImage");
}

/**
 * Hand a rendered card to whatever the device offers, best first:
 *  1. the native share sheet (iOS builds with ShareImagePlugin) — Instagram
 *     Stories, WhatsApp, Save Image;
 *  2. the Web Share API with a file (Safari, Chrome on Android);
 *  3. a download (desktop browsers).
 * Builds before the plugin get `unsupported` when 2 is missing too, and the
 * caller shows the image so it can be long-pressed and saved.
 */
export async function shareImage(
  blob: Blob,
  opts: { fileName: string; text?: string; url?: string },
): Promise<ShareOutcome> {
  if (nativeAvailable()) {
    const image = await blobToBase64(blob);
    try {
      const r = await plugin.share({ image, text: opts.text, url: opts.url });
      return r.completed ? "shared" : "dismissed";
    } catch {
      return "dismissed";
    }
  }
  const file = new File([blob], opts.fileName, { type: blob.type || "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text: [opts.text, opts.url].filter(Boolean).join(" ") || undefined });
      return "shared";
    } catch {
      return "dismissed";
    }
  }
  if (Capacitor.isNativePlatform()) return "unsupported";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = opts.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return "downloaded";
}

/** Share a plain link + text (invites). Native sheet via navigator.share. */
export async function shareLink(opts: { title?: string; text: string; url: string }): Promise<"shared" | "copied" | "dismissed"> {
  if (navigator.share) {
    try {
      await navigator.share({ title: opts.title, text: opts.text, url: opts.url });
      return "shared";
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return "dismissed";
    }
  }
  try {
    await navigator.clipboard.writeText(`${opts.text} ${opts.url}`);
    return "copied";
  } catch {
    return "dismissed";
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",", 2)[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
