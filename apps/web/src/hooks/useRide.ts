import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  RideClientFrame,
  RidePosition,
  RideRally,
  RideRoute,
  RideServerFrame,
} from "@mototracker/shared";
import { api } from "@/lib/api";
import { env } from "@/env";
import { haversineKm } from "@/lib/geo";
import { watchBestPosition } from "@/lib/tripTracking";

export interface RideMember {
  userId: string;
  name: string;
  /** The leader: the only member who may share a route or set a rally point. */
  isOwner?: boolean;
  pos?: RidePosition | null;
}
export interface RideGroup {
  id: string;
  code: string;
  ownerId: string;
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
/** A jump this big between two fixes is a GPS glitch, not distance ridden. */
const MAX_STEP_KM = 2;

/** What the rider gets when the ride ends. Accumulated on device, never sent. */
export interface RideStats {
  startedAt: number;
  /** Distance *you* covered while the ride was live. */
  distanceKm: number;
  /** The largest the group ever got — a ride that peaked at 7 says so. */
  peakRiders: number;
}

export interface RideChannel {
  live: RideMember[];
  ended: boolean;
  /** False while the socket is down — shown, because at speed it matters. */
  connected: boolean;
  /** The leader's shared route, as everyone in the group sees it. */
  route: RideRoute | null;
  rally: (RideRally & { at: number }) | null;
  /** Leader only (the server ignores it from anyone else). */
  shareRoute: (route: RideRoute | null) => boolean;
  setRally: (rally: RideRally | null) => boolean;
  getStats: () => RideStats;
}

/**
 * The live half of a group ride: keeps a WebSocket open (one-time ticket per
 * connection, auto-reconnect), streams our GPS position up, and exposes the
 * roster plus the two pieces of leader-shared state — the planned route and the
 * rally point.
 *
 * Positions come from the native background watcher on device (sharing keeps
 * working with the screen off / app backgrounded — same mechanism as trip
 * recording), falling back to the browser Geolocation API on web.
 *
 * Nothing here is persisted anywhere: the roster and the shared state live in
 * server memory for the life of the ride, and the ride summary is accumulated
 * in this hook and thrown away when the page unmounts.
 */
export function useRideChannel(
  groupId: string | null,
  background?: { title: string; message: string },
): RideChannel {
  const [live, setLive] = useState<RideMember[]>([]);
  const [ended, setEnded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [route, setRoute] = useState<RideRoute | null>(null);
  const [rally, setRallyState] = useState<(RideRally & { at: number }) | null>(null);
  const qc = useQueryClient();
  const stopped = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  // Re-sent on reconnect: if the server restarted mid-ride, the room's memory
  // went with it and the group would silently lose the line they are following.
  const sharedRoute = useRef<RideRoute | null>(null);
  const sharedRally = useRef<RideRally | null>(null);
  const stats = useRef<RideStats>({ startedAt: Date.now(), distanceKm: 0, peakRiders: 0 });

  const send = useCallback((frame: RideClientFrame): boolean => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(frame));
    return true;
  }, []);

  useEffect(() => {
    if (!groupId) return;
    stopped.current = false;
    setEnded(false);
    stats.current = { startedAt: Date.now(), distanceKm: 0, peakRiders: 0 };
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let sendTimer: ReturnType<typeof setInterval> | null = null;
    let lastPos: { lat: number; lng: number; speed: number | null } | null = null;
    let lastMeasured: { lat: number; lng: number } | null = null;

    const watch = watchBestPosition(
      (s) => {
        lastPos = { lat: s.lat, lng: s.lng, speed: s.speed ?? null };
        // Own-distance for the end-of-ride summary. Single fixes can jump by
        // kilometres when a tunnel ends; those are dropped rather than banked.
        if (lastMeasured) {
          const step = haversineKm(lastMeasured, s);
          if (step < MAX_STEP_KM) stats.current.distanceKm += step;
        }
        lastMeasured = { lat: s.lat, lng: s.lng };
      },
      {
        backgroundTitle: background?.title ?? "Garajım",
        backgroundMessage: background?.message ?? "",
      },
    );

    async function connect() {
      if (stopped.current) return;
      try {
        const { ticket } = await api<{ ticket: string }>("/api/ride-groups/ws-ticket");
        ws = new WebSocket(`${wsBase()}/api/ride-ws?ticket=${ticket}`);
        wsRef.current = ws;
        ws.onopen = () => {
          setConnected(true);
          // Re-assert whatever we own. Ignored by the server for a follower.
          if (sharedRoute.current) send({ t: "route", route: sharedRoute.current });
          if (sharedRally.current) send({ t: "rally", rally: sharedRally.current });
        };
        ws.onmessage = (ev) => {
          let msg: RideServerFrame;
          try {
            msg = JSON.parse(ev.data as string) as RideServerFrame;
          } catch {
            return;
          }
          if (msg.type === "roster" && Array.isArray(msg.members)) {
            setLive(msg.members);
            stats.current.peakRiders = Math.max(stats.current.peakRiders, msg.members.length);
          }
          if (msg.type === "state") {
            setRoute(msg.route ?? null);
            setRallyState(msg.rally ?? null);
          }
          if (msg.type === "ended") {
            stopped.current = true;
            setEnded(true);
            void qc.invalidateQueries({ queryKey: RIDE_KEY });
          }
        };
        ws.onclose = () => {
          setConnected(false);
          if (!stopped.current) reconnectTimer = setTimeout(() => void connect(), RECONNECT_MS);
        };
      } catch {
        // Ticket fetch failed (ride gone / offline) — retry until unmounted.
        setConnected(false);
        if (!stopped.current) reconnectTimer = setTimeout(() => void connect(), RECONNECT_MS);
      }
    }
    void connect();

    sendTimer = setInterval(() => {
      if (lastPos) send({ t: "pos", ...lastPos });
    }, SEND_EVERY_MS);

    return () => {
      stopped.current = true;
      watch.stop();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (sendTimer) clearInterval(sendTimer);
      ws?.close();
      wsRef.current = null;
      sharedRoute.current = null;
      sharedRally.current = null;
      setConnected(false);
    };
    // `background` strings are display-only; reconnecting on language change
    // would drop the socket for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, qc, send]);

  const shareRoute = useCallback(
    (next: RideRoute | null) => {
      sharedRoute.current = next;
      // Optimistic: the leader's own map should not wait for the round trip.
      setRoute(next);
      return send({ t: "route", route: next });
    },
    [send],
  );

  const setRally = useCallback(
    (next: RideRally | null) => {
      sharedRally.current = next;
      setRallyState(next ? { ...next, at: Date.now() } : null);
      return send({ t: "rally", rally: next });
    },
    [send],
  );

  const getStats = useCallback(() => ({ ...stats.current }), []);

  return { live, ended, connected, route, rally, shareRoute, setRally, getStats };
}
