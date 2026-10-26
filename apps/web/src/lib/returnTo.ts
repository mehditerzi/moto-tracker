/**
 * Where to go after signing in.
 *
 * A friend taps a ride invite (/rides/ABC123) without being signed in; the
 * auth gate sends them to /welcome, and without this they land on the
 * dashboard afterwards with the invite lost. The path is kept in localStorage
 * (not sessionStorage) because Google/Apple sign-in leaves the page and comes
 * back, and it expires so a stale link cannot hijack a sign-in days later.
 */
const KEY = "garajim.returnTo";
const TTL_MS = 30 * 60_000;

export function rememberReturnTo(path: string): void {
  if (!path.startsWith("/") || path.startsWith("//")) return;
  if (path === "/" || path.startsWith("/dashboard")) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    /* storage unavailable — the user just lands on the dashboard */
  }
}

/** The remembered path, once; null when there is none or it went stale. */
export function consumeReturnTo(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    localStorage.removeItem(KEY);
    const { path, at } = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof path !== "string" || typeof at !== "number" || Date.now() - at > TTL_MS) return null;
    if (!path.startsWith("/") || path.startsWith("//")) return null;
    return path;
  } catch {
    return null;
  }
}
