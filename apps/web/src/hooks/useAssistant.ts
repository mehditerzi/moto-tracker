import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  Attachment,
  AttachmentKind,
  CostSummary,
  Expense,
  ExpenseCreateInput,
  ExpenseUpdateInput,
  Mechanic,
  MechanicCreateInput,
  MechanicUpdateInput,
  SosContact,
  SosContactCreateInput,
} from "@mototracker/shared";
import { ENTITLEMENT_KEY } from "@/hooks/useEntitlement";

// ─── expenses + cost report ───────────────────────────────────────────────────

export function useExpenses(bikeId?: string) {
  return useQuery<Expense[]>({
    queryKey: ["expenses", bikeId],
    queryFn: () => api<Expense[]>(`/api/expenses?bikeId=${encodeURIComponent(bikeId!)}`),
    enabled: !!bikeId,
  });
}

export function useCostSummary(bikeId?: string) {
  return useQuery<CostSummary>({
    queryKey: ["costSummary", bikeId],
    queryFn: () => api<CostSummary>(`/api/expenses/summary?bikeId=${encodeURIComponent(bikeId!)}`),
    enabled: !!bikeId,
  });
}

/** Every write that moves money invalidates the report too. */
function invalidateCosts(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["expenses"] });
  void qc.invalidateQueries({ queryKey: ["costSummary"] });
  void qc.invalidateQueries({ queryKey: ["dashboard"] });
  void qc.invalidateQueries({ queryKey: ["bikes"] });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ExpenseCreateInput) => api<Expense>("/api/expenses", { method: "POST", json: input }),
    onSuccess: () => invalidateCosts(qc),
  });
}

export function useUpdateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: ExpenseUpdateInput & { id: string }) =>
      api<Expense>(`/api/expenses/${id}`, { method: "PATCH", json: input }),
    onSuccess: () => invalidateCosts(qc),
  });
}

export function useDeleteExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/expenses/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateCosts(qc),
  });
}

// ─── mechanics ────────────────────────────────────────────────────────────────

export function useMechanics() {
  return useQuery<Mechanic[]>({ queryKey: ["mechanics"], queryFn: () => api<Mechanic[]>("/api/mechanics") });
}

export function useSaveMechanic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: (MechanicCreateInput | MechanicUpdateInput) & { id?: string }) =>
      id
        ? api<Mechanic>(`/api/mechanics/${id}`, { method: "PATCH", json: input })
        : api<Mechanic>("/api/mechanics", { method: "POST", json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mechanics"] }),
  });
}

export function useDeleteMechanic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/mechanics/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mechanics"] }),
  });
}

// ─── SOS contacts ─────────────────────────────────────────────────────────────

export function useSosContacts() {
  return useQuery<SosContact[]>({ queryKey: ["sosContacts"], queryFn: () => api<SosContact[]>("/api/sos-contacts") });
}

export function useAddSosContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SosContactCreateInput) =>
      api<SosContact>("/api/sos-contacts", { method: "POST", json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sosContacts"] }),
  });
}

export function useDeleteSosContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/sos-contacts/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sosContacts"] }),
  });
}

// ─── glovebox ─────────────────────────────────────────────────────────────────

export function useAttachments(bikeId?: string) {
  return useQuery<Attachment[]>({
    queryKey: ["attachments", bikeId ?? "all"],
    queryFn: () =>
      api<Attachment[]>(`/api/attachments${bikeId ? `?bikeId=${encodeURIComponent(bikeId)}` : ""}`),
  });
}

export function attachmentFileUrl(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}/file`;
}

export function useUploadAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { file: File; title: string; kind: AttachmentKind; bikeId?: string | null; expiresOn?: string | null }) => {
      const fd = new FormData();
      fd.append("file", input.file);
      fd.append("title", input.title);
      fd.append("kind", input.kind);
      if (input.bikeId) fd.append("bikeId", input.bikeId);
      if (input.expiresOn) fd.append("expiresOn", input.expiresOn);
      // api() leaves Content-Type unset for a FormData body, so the browser
      // writes the multipart boundary — and it attaches the native bearer.
      return api<Attachment>("/api/attachments", { method: "POST", body: fd });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["attachments"] });
      void qc.invalidateQueries({ queryKey: ENTITLEMENT_KEY });
    },
  });
}

export function useDeleteAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/attachments/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["attachments"] });
      void qc.invalidateQueries({ queryKey: ENTITLEMENT_KEY });
    },
  });
}
