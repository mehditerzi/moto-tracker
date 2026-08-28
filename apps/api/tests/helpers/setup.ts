import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import net from "node:net";
import type { AddressInfo, Server } from "node:net";
import { afterAll } from "vitest";
import supertest from "supertest";
import { config } from "../../src/config.js";

/**
 * Per-worker test isolation. Runs once per test FILE (vitest `setupFiles`,
 * `pool: "forks"`), before the test module is imported.
 *
 * Everything here closes a way for two test files in parallel worker processes
 * to corrupt each other. The suite was failing about one run in two, in a
 * different test each time; all of it came from the hazards below rather than
 * from anything the tests were actually asserting on.
 */

// ---------------------------------------------------------------------------
// 1. Dial the address the ephemeral test server is actually listening on.
// ---------------------------------------------------------------------------
// supertest opens a brand-new throwaway server for EVERY request, and then
// hardcodes where it sends that request (supertest/lib/test.js):
//
//     if (!addr) this._server = app.listen(0);   // binds the WILDCARD address
//     return protocol + '://127.0.0.1:' + port + path;
//
// Those are not the same socket. `listen(0)` with no host binds `::`
// (dual-stack), while the request goes to the IPv4 loopback — and BSD delivers
// a connection to the MOST SPECIFIC matching listener. Node sets SO_REUSEADDR,
// so the wildcard bind happily succeeds on a port another local process already
// owns as `127.0.0.1:<port>`; that process then receives supertest's request and
// the express app never sees it.
//
// Not hypothetical. A full run opens tens of thousands of these servers across
// parallel workers, and the failures we captured were real replies from other
// daemons on this machine:
//
//   - the Ollama web UI answering a sign-up POST with 200 + an HTML body and no
//     Set-Cookie  →  "no Set-Cookie on sign-up; got status 200"
//   - the Tailscale local API answering an authenticated request with
//     401 "auth required"  →  the 401s on cookies that were perfectly valid
//
// Both listen on 127.0.0.1 inside the ephemeral port range. Neither has anything
// to do with the tests that were failing, which is exactly why the failure moved
// around and why serialising the files only made it rarer.
//
// The fix is to stop dialling an address we did not bind: ask the server where
// it actually is and use the loopback address of that family. `listen(0)` binds
// the IPv6 wildcard here, so `[::1]` reaches our server and no IPv4-loopback
// listener can intercept it. Patched on supertest's prototype because supertest
// builds this URL itself, inside every single `request(app)`.
interface SupertestPatchTarget {
  Test: { prototype: { serverAddress(app: Server, path: string): string } };
}
const { Test } = supertest as unknown as SupertestPatchTarget;

Test.prototype.serverAddress = function serverAddress(
  this: { _server?: Server },
  app: Server,
  requestPath: string,
): string {
  let addr = app.address() as AddressInfo | null;
  if (!addr) {
    // Keep the bare `listen(0)`: it is the only form that binds synchronously,
    // and supertest needs the port back before this function returns. Naming a
    // host defers the bind to a dns.lookup tick and `address()` is still null.
    this._server = app.listen(0);
    addr = app.address() as AddressInfo;
  }
  const host = addr.family === "IPv6" ? "[::1]" : "127.0.0.1";
  const protocol = app instanceof https.Server ? "https" : "http";
  return `${protocol}://${host}:${addr.port}${requestPath}`;
};

// rideGroups.test.ts stands up real WebSocket servers the same way —
// `server.listen(0, cb)` and then `ws://127.0.0.1:${port}` — so it carries the
// identical hazard. It waits for the listening callback, which means the bind is
// allowed to be asynchronous, and naming the host is then the stronger fix: the
// kernel cannot hand us a port that is already taken on the address we dial.
//
// Deliberately narrow. Only the two-argument `listen(0, callback)` form is
// rewritten; supertest's bare `listen(0)` must keep the synchronous wildcard
// bind, because it reads `address()` on the very next line and naming a host
// defers the bind to a dns.lookup tick.
const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function patchedListen(
  this: net.Server,
  ...args: unknown[]
): net.Server {
  if (args.length === 2 && args[0] === 0 && typeof args[1] === "function") {
    return originalListen.call(this, { port: 0, host: "127.0.0.1" }, args[1] as () => void);
  }
  return (originalListen as (...a: unknown[]) => net.Server).apply(this, args);
} as typeof net.Server.prototype.listen;

// ---------------------------------------------------------------------------
// 2. A private uploads directory per test file.
// ---------------------------------------------------------------------------
// Every worker used to share the one default `/tmp/mototracker-test-uploads`:
// documents.test.ts `rm -rf`s it in an afterEach while, in another process,
// orgScoping.test.ts is uploading a photo into it and deleteAccount.test.ts is
// asserting on files inside it. `mkdtemp` is atomic, so two workers cannot be
// handed the same directory even if they start in the same millisecond.
//
// Test files that already pin their own directory (bikePhoto, fuelReceipt) do it
// at module scope, which runs after this file, so they keep winning.
const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "garajim-test-uploads-"));
(config as { UPLOADS_DIR: string }).UPLOADS_DIR = uploadsDir;

afterAll(() => {
  fs.rmSync(uploadsDir, { recursive: true, force: true });
});

// The third hazard — test accounts whose email came from `Date.now()`, so two
// sign-ups in the same millisecond collided on `user.email UNIQUE` — is fixed at
// its source in helpers/authedRequest.ts.
