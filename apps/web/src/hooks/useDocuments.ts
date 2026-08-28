import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { env } from "@/env";
import { isNative, getBearerToken } from "@/lib/nativeAuth";
import type {
  Document,
  DocumentBatch,
  DocumentBatchDetail,
  ReviewDecision,
  ReviewState,
} from "@mototracker/shared";

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
  /** Bulk capture: the session this shot belongs to. Excludes `bikeId`. */
  batchId?: string;
  /** Passed through to fetch — lets callers abort an in-flight upload. */
  signal?: AbortSignal;
}

export async function uploadDocument(input: UploadDocumentInput): Promise<Document> {
  const fd = new FormData();
  fd.append("file", input.file);
  const qs = input.batchId
    ? `?batchId=${encodeURIComponent(input.batchId)}`
    : input.bikeId
      ? `?bikeId=${encodeURIComponent(input.bikeId)}`
      : "";
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

// ─── bulk capture ─────────────────────────────────────────────────────────────

/**
 * Poll cadence for a batch that still has documents in the OCR queue. Slower
 * than the single-document review screen on purpose: a batch is a minutes-long
 * job by design (the worker runs bulk work behind every interactive scan), and
 * the user is not staring at a spinner — they are reviewing the documents that
 * have already landed. One request every four seconds is enough to keep the
 * header honest without draining the phone for the whole pass.
 */
const BATCH_POLL_MS = 4000;
/** After this long we stop polling and offer an explicit refresh instead. */
const BATCH_POLL_GIVE_UP_MS = 10 * 60_000;

export const batchKeys = {
  list: ["document-batches"] as const,
  detail: (id: string | undefined) => ["document-batch", id] as const,
};

/** The caller's unfinished batches — the "you left 12 documents here" prompt. */
export function useOpenBatches(enabled = true) {
  return useQuery<DocumentBatch[]>({
    queryKey: batchKeys.list,
    queryFn: () => api<DocumentBatch[]>("/api/documents/batches"),
    enabled,
    staleTime: 30_000,
  });
}

export function useBatch(id: string | undefined) {
  const startedAt = useRef(Date.now());
  return useQuery<DocumentBatchDetail>({
    queryKey: batchKeys.detail(id),
    queryFn: () => api<DocumentBatchDetail>(`/api/documents/batches/${id}`),
    enabled: !!id,
    refetchInterval: (q) => {
      const data = q.state.data as DocumentBatchDetail | undefined;
      if (!data || data.batch.progress.pending === 0) return false;
      if (Date.now() - startedAt.current > BATCH_POLL_GIVE_UP_MS) return false;
      return BATCH_POLL_MS;
    },
  });
}

export function useCreateBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { orgId?: string | null } = {}) =>
      api<DocumentBatch>("/api/documents/batches", {
        method: "POST",
        json: { orgId: input.orgId ?? null },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: batchKeys.list });
    },
  });
}

export interface SaveDecisionInput {
  documentId: string;
  batchId: string;
  state: ReviewState;
  decision?: ReviewDecision;
}

/**
 * Persist one document's decision. Every confirm writes; the review pass is
 * resumable precisely because nothing important lives only in component state.
 * The batch query is patched in place rather than refetched — a round trip
 * between "confirm" and the next document would be felt on every single one.
 */
export function useSaveDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveDecisionInput) =>
      api<Document>(`/api/documents/${input.documentId}/decision`, {
        method: "PATCH",
        json: { state: input.state, decision: input.decision },
      }),
    onSuccess: (doc, input) => {
      qc.setQueryData<DocumentBatchDetail>(batchKeys.detail(input.batchId), (prev) =>
        prev
          ? {
              ...prev,
              documents: prev.documents.map((d) =>
                // Keep the server's freshly computed `suggestion`: the PATCH
                // response is a plain document row and does not carry it.
                d.id === doc.id ? { ...d, ...doc, suggestion: d.suggestion } : d,
              ),
            }
          : prev,
      );
    },
  });
}

/** Re-queue a document whose scan failed. Costs no upload allowance. */
export function useRescanDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { documentId: string; batchId?: string }) =>
      api<Document>(`/api/documents/${input.documentId}/rescan`, { method: "POST" }),
    onSuccess: (doc, input) => {
      if (input.batchId) {
        qc.setQueryData<DocumentBatchDetail>(batchKeys.detail(input.batchId), (prev) =>
          prev
            ? {
                ...prev,
                batch: {
                  ...prev.batch,
                  progress: {
                    ...prev.batch.progress,
                    pending: prev.batch.progress.pending + 1,
                    failed: Math.max(0, prev.batch.progress.failed - 1),
                  },
                },
                documents: prev.documents.map((d) =>
                  d.id === doc.id ? { ...d, ...doc, suggestion: "none" as const } : d,
                ),
              }
            : prev,
        );
      }
      qc.invalidateQueries({ queryKey: ["document", doc.id] });
    },
  });
}

export interface ApplyBatchResult {
  batchId: string;
  created: number;
  updated: number;
  merged: number;
  datedItems: number;
  bikeIds: string[];
}

export function useApplyBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) =>
      api<ApplyBatchResult>(`/api/documents/batches/${batchId}/apply`, { method: "POST" }),
    onSuccess: (_res, batchId) => {
      qc.invalidateQueries({ queryKey: ["bikes"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: batchKeys.list });
      qc.invalidateQueries({ queryKey: batchKeys.detail(batchId) });
    },
  });
}

export function useDiscardBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) =>
      api<void>(`/api/documents/batches/${batchId}`, { method: "DELETE" }),
    onSuccess: (_res, batchId) => {
      qc.removeQueries({ queryKey: batchKeys.detail(batchId) });
      qc.invalidateQueries({ queryKey: batchKeys.list });
    },
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { documentId: string; batchId?: string }) =>
      api<void>(`/api/documents/${input.documentId}`, { method: "DELETE" }),
    onSuccess: (_res, input) => {
      if (input.batchId) qc.invalidateQueries({ queryKey: batchKeys.detail(input.batchId) });
    },
  });
}
