import crypto from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

/**
 * Live-position fan-out for group rides. Everything here is in-memory and
 * ephemeral on purpose: positions are relayed, never persisted, so a group
 * ride leaves no server-side location trail. A restart just drops connections;
 * clients reconnect with a fresh ticket.
 *
 * Auth: WebSocket upgrades can't reliably carry the session (native app uses
 * bearer headers; cookies are origin-bound), so the REST layer mints a
 * one-time short-lived ticket bound to (user, group) and the socket presents
 * it in the URL.
 */

const TICKET_TTL_MS = 60_000;
/** Per-group broadcast throttle — position updates coalesce into ≤1 roster/second. */
const BROADCAST_MIN_MS = 1000;

interface Ticket {
  userId: string;
  groupId: string;
  name: string;
  expiresAt: number;
}

interface MemberState {
  ws: WebSocket;
  userId: string;
  name: string;
  pos: { lat: number; lng: number; speed: number | null; t: number } | null;
}

const tickets = new Map<string, Ticket>();
const rooms = new Map<string, Map<string, MemberState>>();

export function createRideTicket(userId: string, groupId: string, name: string): string {
  const ticket = crypto.randomBytes(24).toString("base64url");
  tickets.set(ticket, { userId, groupId, name, expiresAt: Date.now() + TICKET_TTL_MS });
  return ticket;
}

/** One-time: a ticket is deleted on first use (or expiry). */
export function consumeRideTicket(ticket: string): Omit<Ticket, "expiresAt"> | null {
  const t = tickets.get(ticket);
  tickets.delete(ticket);
  if (!t || t.expiresAt < Date.now()) return null;
  return { userId: t.userId, groupId: t.groupId, name: t.name };
}

const lastBroadcast = new Map<string, number>();
const pendingBroadcast = new Map<string, ReturnType<typeof setTimeout>>();

function roster(groupId: string): string {
  const room = rooms.get(groupId);
  const members = room
    ? [...room.values()].map((m) => ({ userId: m.userId, name: m.name, pos: m.pos }))
    : [];
  return JSON.stringify({ type: "roster", members });
}

function broadcast(groupId: string): void {
  const room = rooms.get(groupId);
  if (!room) return;
  const msg = roster(groupId);
  for (const m of room.values()) {
    if (m.ws.readyState === WebSocket.OPEN) m.ws.send(msg);
  }
  lastBroadcast.set(groupId, Date.now());
}

/** Coalesce rapid position updates into at most one roster per second. */
function scheduleBroadcast(groupId: string): void {
  const since = Date.now() - (lastBroadcast.get(groupId) ?? 0);
  if (since >= BROADCAST_MIN_MS) {
    broadcast(groupId);
    return;
  }
  if (!pendingBroadcast.has(groupId)) {
    pendingBroadcast.set(
      groupId,
      setTimeout(() => {
        pendingBroadcast.delete(groupId);
        broadcast(groupId);
      }, BROADCAST_MIN_MS - since),
    );
  }
}

/** Kick every socket in a group (used when the ride is ended). */
export function closeRideRoom(groupId: string): void {
  const room = rooms.get(groupId);
  if (!room) return;
  const msg = JSON.stringify({ type: "ended" });
  for (const m of room.values()) {
    if (m.ws.readyState === WebSocket.OPEN) {
      m.ws.send(msg);
      m.ws.close(1000, "ride_ended");
    }
  }
  rooms.delete(groupId);
  lastBroadcast.delete(groupId);
  const pending = pendingBroadcast.get(groupId);
  if (pending) clearTimeout(pending);
  pendingBroadcast.delete(groupId);
}

const posSchema = {
  ok(v: unknown): v is { lat: number; lng: number; speed?: number | null } {
    const o = v as Record<string, unknown>;
    return (
      !!o &&
      typeof o.lat === "number" &&
      o.lat >= -90 &&
      o.lat <= 90 &&
      typeof o.lng === "number" &&
      o.lng >= -180 &&
      o.lng <= 180
    );
  },
};

export function attachRideWs(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/ride-ws") return; // not ours (leave for others / 404)
    const auth = consumeRideTicket(url.searchParams.get("ticket") ?? "");
    if (!auth) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const room = rooms.get(auth.groupId) ?? new Map<string, MemberState>();
      rooms.set(auth.groupId, room);
      // A reconnect replaces the old socket for the same user.
      room.get(auth.userId)?.ws.close(1000, "replaced");
      const state: MemberState = { ws, userId: auth.userId, name: auth.name, pos: null };
      room.set(auth.userId, state);
      broadcast(auth.groupId);

      ws.on("message", (data) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(data));
        } catch {
          return;
        }
        if (!posSchema.ok(parsed)) return;
        state.pos = {
          lat: parsed.lat,
          lng: parsed.lng,
          speed: typeof parsed.speed === "number" ? parsed.speed : null,
          t: Date.now(),
        };
        scheduleBroadcast(auth.groupId);
      });

      ws.on("close", () => {
        const r = rooms.get(auth.groupId);
        if (r?.get(auth.userId)?.ws === ws) {
          r.delete(auth.userId);
          if (r.size === 0) rooms.delete(auth.groupId);
          else broadcast(auth.groupId);
        }
      });
    });
  });
}
