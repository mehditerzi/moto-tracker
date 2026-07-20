import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { env } from "@/env";

export interface RideMember {
  userId: string;
  name: string;
  pos?: { lat: number; lng: number; speed: number | null; t: number } | null;
}
export interface RideGroup {
  id: string;
  code: string;
  isOwner: boolean;
  createdAt: string;
  members: RideMember[];
}

const RIDE_KEY = ["rideGroup"];

export function useActiveRide() {
  return useQuery<RideGroup | null>({
    queryKey: RIDE_KEY,
    queryFn: () => api<RideGroup | null>("/api/ride-groups/active"),
  });
}

export function useCreateRide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<RideGroup>("/api/ride-groups", { method: "POST", json: {} }),
    onSuccess: (g) => qc.setQueryData(RIDE_KEY, g),
  });
}

export function useJoinRide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      api<RideGroup>("/api/ride-groups/join", { method: "POST", json: { code } }),
    onSuccess: (g) => qc.setQueryData(RIDE_KEY, g),
  });
}

export function useLeaveRide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: boolean }>("/api/ride-groups/leave", { method: "POST", json: {} }),
    onSuccess: () => qc.setQueryData(RIDE_KEY, null),
  });
}

function wsBase(): string {
  const base = env.VITE_API_URL || window.location.origin;
  return base.replace(/^http/, "ws");
}

const SEND_EVERY_MS = 3000;
const RECONNECT_MS = 3000;

/**
 * The live half of a group ride: keeps a WebSocket open (one-time ticket per
 * connection, auto-reconnect), streams our GPS position up, and exposes the
 * latest roster. `ended` flips when the owner closes the ride remotely.
 */
export function useRideChannel(groupId: string | null): { live: RideMember[]; ended: boolean } {
  const [live, setLive] = useState<RideMember[]>([]);
  const [ended, setEnded] = useState(false);
  const qc = useQueryClient();
  const stopped = useRef(false);

  useEffect(() => {
    if (!groupId) return;
    stopped.current = false;
    setEnded(false);
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let sendTimer: ReturnType<typeof setInterval> | null = null;
    let lastPos: { lat: number; lng: number; speed: number | null } | null = null;

    const watchId =
      typeof navigator !== "undefined" && navigator.geolocation
        ? navigator.geolocation.watchPosition(
            (p) => {
              lastPos = {
                lat: p.coords.latitude,
                lng: p.coords.longitude,
                speed: p.coords.speed,
              };
            },
            () => {},
            { enableHighAccuracy: true, maximumAge: 2000 },
          )
        : null;

    async function connect() {
      if (stopped.current) return;
      try {
        const { ticket } = await api<{ ticket: string }>("/api/ride-groups/ws-ticket");
        ws = new WebSocket(`${wsBase()}/api/ride-ws?ticket=${ticket}`);
        ws.onmessage = (ev) => {
          const msg = JSON.parse(ev.data as string) as {
            type: string;
            members?: RideMember[];
          };
          if (msg.type === "roster" && msg.members) setLive(msg.members);
          if (msg.type === "ended") {
            stopped.current = true;
            setEnded(true);
            void qc.invalidateQueries({ queryKey: RIDE_KEY });
          }
        };
        ws.onclose = () => {
          if (!stopped.current) reconnectTimer = setTimeout(() => void connect(), RECONNECT_MS);
        };
      } catch {
        // Ticket fetch failed (ride gone / offline) — retry until unmounted.
        if (!stopped.current) reconnectTimer = setTimeout(() => void connect(), RECONNECT_MS);
      }
    }
    void connect();

    sendTimer = setInterval(() => {
      if (lastPos && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(lastPos));
    }, SEND_EVERY_MS);

    return () => {
      stopped.current = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (sendTimer) clearInterval(sendTimer);
      ws?.close();
    };
  }, [groupId, qc]);

  return { live, ended };
}
