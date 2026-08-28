import { env } from "@/env";
import { isNative, getBearerToken, clearBearerToken } from "./nativeAuth";

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

export interface ApiOptions extends RequestInit {
  json?: unknown;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { json, headers, ...rest } = opts;
  // On native, the cross-site cookie is dropped by WKWebView, so authenticate
  // with the stored bearer token instead. Web relies on the httpOnly cookie.
  const bearer = isNative() ? getBearerToken() : null;
  const res = await fetch(`${env.VITE_API_URL}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(headers ?? {}),
    },
    body: json ? JSON.stringify(json) : (rest.body as BodyInit | undefined),
  });
  // A stale token is worthless — drop it so the app falls back to the login flow.
  if (res.status === 401 && isNative()) clearBearerToken();
  // 304 is not a failure, but it has no body we can parse, and `res.ok` is
  // false for it — so the old code threw and callers read that as "request
  // failed". On /api/me that meant a successful sign-in bounced the user back
  // to the login page. The server now sends no-store so this should never
  // happen, but a CDN or a stale service worker can still revalidate, and the
  // cost of being wrong here is a login loop. Re-fetch once, bypassing caches.
  if (res.status === 304) {
    const fresh = await fetch(`${env.VITE_API_URL}${path}`, {
      ...rest,
      cache: "reload",
      credentials: "include",
      headers: {
        ...(json ? { "Content-Type": "application/json" } : {}),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...(headers ?? {}),
      },
      body: json ? JSON.stringify(json) : (rest.body as BodyInit | undefined),
    });
    if (fresh.ok) return fresh.status === 204 ? (undefined as T) : ((await fresh.json()) as T);
    throw new ApiError(fresh.status, `${rest.method ?? "GET"} ${path} failed (${fresh.status})`);
  }
  if (!res.ok) {
    let body: unknown = undefined;
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    throw new ApiError(res.status, `${rest.method ?? "GET"} ${path} failed (${res.status})`, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
