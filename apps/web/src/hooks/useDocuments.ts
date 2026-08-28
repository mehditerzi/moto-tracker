import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { env } from "@/env";
import { isNative, getBearerToken } from "@/lib/nativeAuth";
import type { Document } from "@mototracker/shared";

/** Poll cadence for a pending scan, measured from when the review screen
 *  mounted. We don't derive it from `document.createdAt`: sqlite returns a naive
 *  "YYYY-MM-DD HH:MM:SS" that Safari reads as local time, which would put the
 *  elapsed reading hours out on any non-UTC device. */
const POLL_FAST_MS = 1500;
const POLL_SLOW_MS = 4000;
const POLL_FAST_UNTIL_MS = 30_000;
const POLL_GIVE_UP_MS = 3 * 60_000;

export function useDocument(id: string | undefined, opts?: { pollWhilePending?: boolean }) {
  const startedAt = useRef(Date.now());
  return useQuery<Document>({
    queryKey: ["document", id],
    queryFn: () => api<Document>(`/api/documents/${id}`),
    enabled: !!id,
    refetchInterval: (q) => {
      if (!opts?.pollWhilePending) return false;
      const data = q.state.data as Document | undefined;
      if (!data || data.ocrStatus !== "pending") return false;
      // The server's per-document ceiling is 120 s and only OCR_CONCURRENCY jobs
      // run at a time across all users, so a document can legitimately sit
      // pending for minutes. Polling every 1.5 s for all of that drains the
      // phone for nothing; past the give-up point the review screen offers an
      // explicit "check again" instead of an endless background poll.
      const elapsed = Date.now() - startedAt.current;
      if (elapsed < POLL_FAST_UNTIL_MS) return POLL_FAST_MS;
      if (elapsed < POLL_GIVE_UP_MS) return POLL_SLOW_MS;
      return false;
    },
  });
}

export function useDocumentsForBike(bikeId: string | undefined) {
  return useQuery<Document[]>({
    queryKey: ["documents", bikeId ?? "all"],
    queryFn: () =>
      api<Document[]>(`/api/documents${bikeId ? `?bikeId=${encodeURIComponent(bikeId)}` : ""}`),
    enabled: !!bikeId,
  });
}

export interface UploadDocumentInput {
  file: File;
  bikeId?: string;
  /** Passed through to fetch — lets callers abort an in-flight upload. */
  signal?: AbortSignal;
}

async function uploadDocument(input: UploadDocumentInput): Promise<Document> {
  const fd = new FormData();
  fd.append("file", input.file);
  const qs = input.bikeId ? `?bikeId=${encodeURIComponent(input.bikeId)}` : "";
  // This is a raw fetch (not the api() wrapper) because it sends FormData, so it
  // must attach the native bearer token itself — WKWebView drops the cross-site
  // cookie, which would 401 the upload on iOS. Do NOT set Content-Type; the
  // browser sets the multipart boundary.
  const bearer = isNative() ? getBearerToken() : null;
  const res = await fetch(`${env.VITE_API_URL}/api/documents${qs}`, {
    method: "POST",
    body: fd,
    credentials: "include",
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
    signal: input.signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Upload failed (${res.status})`);
  }
  return (await res.json()) as Document;
}

export function useUploadDocument() {
  const qc = useQueryClient();
  // One AbortController per in-flight upload; replaced on each new mutation call.
  const abortRef = useRef<AbortController | null>(null);

  const mutation = useMutation({
    mutationFn: (input: UploadDocumentInput) => {
      abortRef.current = new AbortController();
      return uploadDocument({ ...input, signal: abortRef.current.signal });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  /** Cancel the currently in-flight upload. The mutation will reject with an
   *  AbortError — callers should swallow it (it is not a real failure). */
  function abort() {
    abortRef.current?.abort();
  }

  return { ...mutation, abort };
}
