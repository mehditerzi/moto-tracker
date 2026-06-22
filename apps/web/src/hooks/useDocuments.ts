import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { env } from "@/env";
import { isNative, getBearerToken } from "@/lib/nativeAuth";
import type { Document } from "@mototracker/shared";

export function useDocument(id: string | undefined, opts?: { pollWhilePending?: boolean }) {
  return useQuery<Document>({
    queryKey: ["document", id],
    queryFn: () => api<Document>(`/api/documents/${id}`),
    enabled: !!id,
    refetchInterval: (q) => {
      if (!opts?.pollWhilePending) return false;
      const data = q.state.data as Document | undefined;
      return data && data.ocrStatus === "pending" ? 1500 : false;
    },
  });
}

export interface UploadDocumentInput {
  file: File;
  bikeId?: string;
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
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Upload failed (${res.status})`);
  }
  return (await res.json()) as Document;
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: uploadDocument,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
