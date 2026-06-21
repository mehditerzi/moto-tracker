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
