import { ApiError } from "./api";

/** Minimal shape of the translator we need — avoids coupling to i18next types. */
type Translate = (key: string, opts?: Record<string, unknown>) => string;

/**
 * Turn a caught error into a human, localized message. The API returns stable
 * machine codes in `body.error` (e.g. "bike_not_found"); we map those to helpful
 * `errors.*` copy that tells the user what happened and what to do, instead of
 * leaking "ApiError: POST /api/bikes failed (500)" into a toast.
 *
 * Falls back to a friendly generic message for anything unmapped, a connection
 * hint for network failures, and a "session expired" nudge on 401.
 */
export function friendlyError(e: unknown, t: Translate): string {
  if (e instanceof ApiError) {
    const body = e.body as { error?: unknown } | undefined;
    const code = body && typeof body.error === "string" ? body.error : null;
    if (code) {
      const msg = t(`errors.${code}`, { defaultValue: "" });
      if (msg) return msg;
    }
    if (e.status === 401) return t("errors.unauthenticated");
    if (e.status >= 500) return t("errors.server");
    return t("errors.generic");
  }
  // fetch() rejects with a TypeError on network failure (offline, DNS, CORS).
  if (e instanceof TypeError) return t("errors.network");
  return t("errors.generic");
}
