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
/** How often unconsumed (expired) tickets are swept out of the map. */
const TICKET_SWEEP_MS = 60_000;
/** Per-group broadcast throttle — position updates coalesce into ≤1 roster/second. */
const BROADCAST_MIN_MS = 1000;
/**
 * Frames are one small JSON position; 16 KiB is orders of magnitude of slack.
 * (ws defaults to 100 MiB, which one client can allocate at will.)
 */
const MAX_PAYLOAD_BYTES = 16 * 1024;
/** Ping every interval; a socket that missed the previous pong is terminated. */
const HEARTBEAT_MS = 30_000;
/**
 * Ingress cap. Broadcast is throttled, ingress is not, so without this one
 * client can spin the JSON parser as fast as it can write. The app sends one
 * position every 3s (~3 per window); anything past the cap is dropped, and a
 * sustained firehose gets closed.
 */
const MSG_WINDOW_MS = 10_000;
const MSG_MAX_PER_WINDOW = 30;
const MSG_ABUSE_PER_WINDOW = 300;

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
  /** Ingress budget, reset every MSG_WINDOW_MS. */
  msgWindowStart: number;
  msgCount: number;
  /** Cleared on pong; a socket still un-acked at the next beat is dead. */
  awaitingPong: boolean;
}

const tickets = new Map<string, Ticket>();
const rooms = new Map<string, Map<string, MemberState>>();

let ticketSweep: ReturnType<typeof setInterval> | null = null;

/**
 * Tickets are otherwise only removed on consumption, so a client that asks for
 * one and never connects (offline, app killed at the wrong moment, or a bored
 * attacker looping GET /ws-ticket) grows the map forever. The sweeper is
 * unref'd — it must never hold the process open for the test suite or for a
 * graceful shutdown — and stops itself once there is nothing left to sweep.
 */
function ensureTicketSweep(): void {
  if (ticketSweep) return;
  ticketSweep = setInterval(() => {
    const now = Date.now();
    for (const [key, t] of tickets) {
      if (t.expiresAt < now) tickets.delete(key);
    }
    if (tickets.size === 0) stopTicketSweep();
  }, TICKET_SWEEP_MS);
  ticketSweep.unref();
}

function stopTicketSweep(): void {
  if (!ticketSweep) return;
  clearInterval(ticketSweep);
  ticketSweep = null;
}

export function createRideTicket(userId: string, groupId: string, name: string): string {
  const ticket = crypto.randomBytes(24).toString("base64url");
  tickets.set(ticket, { userId, groupId, name, expiresAt: Date.now() + TICKET_TTL_MS });
  ensureTicketSweep();
  return ticket;
}

/** Test seam: force a sweep pass without waiting out the interval. */
export function sweepExpiredTickets(): number {
  const now = Date.now();
  let removed = 0;
  for (const [key, t] of tickets) {
    if (t.expiresAt < now) {
      tickets.delete(key);
      removed++;
    }
  }
  if (tickets.size === 0) stopTicketSweep();
  return removed;
}

/** Test/diagnostic seam: number of tickets currently held in memory. */
export function pendingTicketCount(): number {
  return tickets.size;
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

/** Handle returned by attachRideWs so shutdown can drain the sockets. */
export interface RideWsHandle {
  close(): Promise<void>;
}

export function attachRideWs(server: HttpServer): RideWsHandle {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  server.on("upgrade", (req, socket, head) => {
    // A raw socket with no 'error' listener throws on the next ECONNRESET —
    // and an unhandled 'error' event takes the whole process down.
    socket.on("error", () => socket.destroy());
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/ride-ws") {
      // Nothing else on this server upgrades. Returning here would leave the
      // socket open with no response, burning an fd until the TCP timeout.
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const auth = consumeRideTicket(url.searchParams.get("ticket") ?? "");
    if (!auth) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const room = rooms.get(auth.groupId) ?? new Map<string, MemberState>();
      rooms.set(auth.groupId, room);
      // A reconnect replaces the old socket for the same user.
      room.get(auth.userId)?.ws.close(1000, "replaced");
      const state: MemberState = {
        ws,
        userId: auth.userId,
        name: auth.name,
        pos: null,
        msgWindowStart: Date.now(),
        msgCount: 0,
        awaitingPong: false,
      };
      room.set(auth.userId, state);
      broadcast(auth.groupId);

      // Same reason as the upgrade socket above, and it fires for real: a
      // rider losing signal (ECONNRESET) or sending an over-sized/malformed
      // frame emits 'error' here, which is fatal to the process if unhandled.
      // 'close' still follows, so roster cleanup is already covered.
      ws.on("error", (err) => {
        console.warn(`[ride] socket error for ${auth.userId}:`, (err as Error).message);
      });

      ws.on("pong", () => {
        state.awaitingPong = false;
      });

      ws.on("message", (data) => {
        // Budget check first: an over-budget frame must not reach JSON.parse.
        const now = Date.now();
        if (now - state.msgWindowStart >= MSG_WINDOW_MS) {
          state.msgWindowStart = now;
          state.msgCount = 0;
        }
        state.msgCount++;
        if (state.msgCount > MSG_ABUSE_PER_WINDOW) {
          ws.close(1008, "rate_limit");
          return;
        }
        if (state.msgCount > MSG_MAX_PER_WINDOW) return;

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
          t: now,
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

  /**
   * Heartbeat. A phone that loses signal or gets suspended mid-ride leaves a
   * socket that never emits 'close', so its stale position would sit in the
   * roster indefinitely. Unref'd for the same reason as the ticket sweeper.
   */
  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) {
      for (const m of room.values()) {
        if (m.ws.readyState !== WebSocket.OPEN) continue;
        if (m.awaitingPong) {
          m.ws.terminate(); // fires 'close' → drops them from the roster
          continue;
        }
        m.awaitingPong = true;
        m.ws.ping();
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    close(): Promise<void> {
      clearInterval(heartbeat);
      stopTicketSweep();
      tickets.clear();
      // 1012 "service restart" — deliberately NOT the "ended" frame
      // closeRideRoom sends: the rides aren't over, the clients should
      // reconnect once we're back.
      for (const room of rooms.values()) {
        for (const m of room.values()) m.ws.close(1012, "server_restart");
      }
      rooms.clear();
      lastBroadcast.clear();
      for (const timer of pendingBroadcast.values()) clearTimeout(timer);
      pendingBroadcast.clear();
      return new Promise((resolve) => {
        // wss.close() waits for every client to complete its close handshake;
        // a wedged socket would never get there.
        const forced = setTimeout(() => {
          for (const client of wss.clients) client.terminate();
        }, 2000);
        forced.unref();
        wss.close(() => {
          clearTimeout(forced);
          resolve();
        });
      });
    },
  };
}
