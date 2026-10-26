import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RideEvent, RideEventInput, RideEventList, RsvpStatus } from "@mototracker/shared";
import { api } from "@/lib/api";

const LIST_KEY = ["rideEvents"];
const eventKey = (code: string) => ["rideEvent", code.toUpperCase()];

export function useRideEvents() {
  return useQuery<RideEventList>({
    queryKey: LIST_KEY,
    queryFn: () => api<RideEventList>("/api/ride-events"),
  });
}

export function useRideEvent(code: string | undefined) {
  return useQuery<RideEvent>({
    queryKey: eventKey(code ?? ""),
    queryFn: () => api<RideEvent>(`/api/ride-events/${encodeURIComponent(code!)}`),
    enabled: !!code,
    // The organiser may go live at any moment; a friend waiting on the page
    // should see the "join" button appear without pulling to refresh.
    refetchInterval: 30_000,
  });
}

/** Every mutation answers with the fresh event — store it and refresh the list. */
function useEventMutation<V>(fn: (v: V) => Promise<RideEvent | void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (ev) => {
      if (ev) qc.setQueryData(eventKey(ev.code), ev);
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useCreateRideEvent() {
  return useEventMutation((input: RideEventInput) =>
    api<RideEvent>("/api/ride-events", { method: "POST", json: input }),
  );
}

export function useUpdateRideEvent(id: string) {
  return useEventMutation((input: RideEventInput) =>
    api<RideEvent>(`/api/ride-events/${id}`, { method: "PATCH", json: input }),
  );
}

export function useRsvp(code: string) {
  return useEventMutation((v: { status: RsvpStatus | null; bikeId?: string | null }) =>
    v.status
      ? api<RideEvent>(`/api/ride-events/${code}/rsvp`, { method: "PUT", json: v })
      : api<RideEvent>(`/api/ride-events/${code}/rsvp`, { method: "DELETE" }),
  );
}

export function useCancelRideEvent(id: string) {
  return useEventMutation(() => api<RideEvent>(`/api/ride-events/${id}/cancel`, { method: "POST", json: {} }));
}

export function useDeleteRideEvent(id: string) {
  return useEventMutation(() => api<void>(`/api/ride-events/${id}`, { method: "DELETE" }));
}

export function useStartLiveRide(id: string) {
  return useEventMutation(() => api<RideEvent>(`/api/ride-events/${id}/live`, { method: "POST", json: {} }));
}

export function useRemoveRider(id: string) {
  return useEventMutation((userId: string) =>
    api<RideEvent>(`/api/ride-events/${id}/riders/${userId}`, { method: "DELETE" }),
  );
}

export function useReportRideEvent(code: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      api<{ ok: boolean }>(`/api/ride-events/${code}/report`, { method: "POST", json: { reason } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

/** The link friends receive. Server-rendered so WhatsApp shows a real preview. */
export function inviteUrl(code: string): string {
  return `https://mototracker.mehditerzi.com/r/${code}`;
}
