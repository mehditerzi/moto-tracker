import crypto from "node:crypto";
import type { Database as DB } from "better-sqlite3";
import type { IdentityKind } from "@mototracker/shared";

/**
 * Global vehicle identity: deciding when two records are the same real vehicle.
 *
 * The whole feature — "no one can add the same vehicle twice", "a sold car keeps
 * its history" — rests on this question, and the honest answer is that the three
 * candidate keys are not equally good:
 *
 *   CHASSIS (VIN) is the only STABLE identity. It is assigned at the factory and
 *   survives a sale, a plate change and a move between provinces. It is also
 *   structurally checkable: exactly 17 characters, and the alphabet excludes
 *   I, O and Q so that they can never be confused with 1 and 0. That exclusion
 *   is a gift — it turns three of the most common OCR errors into *corrections*
 *   we can prove rather than guesses we have to hedge.
 *
 *   ENGINE NUMBER is second, and it is NOT stable. Engines get swapped, and on
 *   older cars and motorcycles that is routine rather than exotic. A match is
 *   strong evidence, so it is worth acting on — but it opens a conversation
 *   ("is this your vehicle?") instead of settling one, and the registry
 *   deliberately does not enforce uniqueness on it (027_*.sql): a swapped engine
 *   legitimately appears on two records at once, and refusing to record a true
 *   fact about the world is worse than recording an ambiguous one.
 *
 *   PLATE is not an identity at all, and this module will not treat it as one.
 *   Turkish plates are re-issued, so two different cars hold the same plate at
 *   different times; and a plate changes when a vehicle moves province, so one
 *   car holds two plates over its life. Both directions are wrong. There is a
 *   second, sharper reason: a plate is the one identifier a stranger can read
 *   off a bumper, so a system that answers "that plate is already tracked" is a
 *   plate-to-user oracle with a queue outside it. `normalizePlate` exists here
 *   for display and for the OCR pipeline's own within-garage matching, and it is
 *   never written to the registry.
 *
 * Everything below is pure except the four functions that take a `db`.
 */

// ─── normalisation ────────────────────────────────────────────────────────────

/** Separators that appear in hand-typed and OCR'd identifiers. */
const SEPARATORS = /[\s\-._/\\]+/g;

/**
 * Uppercase, fold Turkish letters to ASCII, drop separators and anything that is
 * not A–Z0–9. Turkish folding matters because a keyboard set to Turkish turns a
 * typed `i` into `İ`, and `toUpperCase()` on that yields a character no VIN
 * contains.
 *
 * Kept deliberately close to `norm()` in ocr/catalog.ts — same idea, different
 * alphabet (that one keeps letters, this one is about to collapse some of them).
 */
export function normalizeIdentifier(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw)
    .replace(/[İıI]/g, "I")
    .replace(/[Şş]/g, "S")
    .replace(/[Ğğ]/g, "G")
    .replace(/[Üü]/g, "U")
    .replace(/[Öö]/g, "O")
    .replace(/[Çç]/g, "C")
    .toUpperCase()
    .replace(SEPARATORS, "")
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * The OCR confusion fold, applied to build a MATCH KEY.
 *
 * Every one of these is a pair of glyphs that a camera, a dirty plate and a
 * 6-point font routinely turn into each other. Folding each pair onto its digit
 * means "VF1RFB00X12345678" and "VFIRFBOOX12345678" produce the same key and are
 * recognised as one vehicle instead of two.
 *
 * The set is deliberately SMALL, and stops where it does for a reason. Every
 * additional class raises the chance of a FALSE match, and a false match here is
 * not a cosmetic bug: it tells someone their brand-new car is "already
 * registered" and sends them into a claim flow that no one will ever approve.
 * So the fold covers only the four confusions that dominate real OCR output
 * (O/0, I/1, S/5, B/8) plus Q→0, which is free on a chassis because Q cannot
 * legally appear in a VIN.
 *
 * Note what is NOT folded: digits never collapse into other digits. That keeps
 * the eight-digit serial at the tail of a VIN — the part where two vehicles of
 * the same model actually differ — fully discriminating, so two genuinely
 * different cars from the same production run can never collide.
 *
 * MUST stay byte-compatible with the nested REPLACE() in 027_*.sql, which
 * backfills the registry from existing rows.
 */
const OCR_FOLD: Record<string, string> = { O: "0", Q: "0", I: "1", S: "5", B: "8" };

export function foldIdentity(raw: string | null | undefined): string {
  const n = normalizeIdentifier(raw);
  let out = "";
  for (const ch of n) out += OCR_FOLD[ch] ?? ch;
  return out;
}

/** VIN alphabet: 17 characters, and I, O and Q are excluded by the standard. */
const VIN_SHAPE = /^[A-HJ-NPR-Z0-9]{17}$/;

/**
 * Correct an OCR'd chassis number into a legal VIN, or answer null.
 *
 * The correction is the interesting part. Because a VIN may not contain I, O or
 * Q, any of those characters in a 17-character string is PROVABLY an OCR error,
 * and the intended character is known: I is a 1, O and Q are 0s. That is a
 * repair we can make with certainty, which is very different from the guessing
 * `foldIdentity` does for matching — so this function returns a value fit to
 * STORE and show a human, while the fold produces only a key fit to compare.
 *
 * Null means "not VIN-shaped", and callers treat that as "no chassis identity"
 * rather than as an error: a half-typed chassis number is common, and it must
 * neither claim an identity nor block one.
 */
export function normalizeChassis(raw: string | null | undefined): string | null {
  const n = normalizeIdentifier(raw);
  if (n.length !== 17) return null;
  const corrected = n.replace(/I/g, "1").replace(/[OQ]/g, "0");
  return VIN_SHAPE.test(corrected) ? corrected : null;
}

/**
 * The floor for treating an engine number as an identity.
 *
 * Engine numbers have no grammar to check against, so length is the only
 * protection against accidental collisions — and a collision blocks a real
 * vehicle from being added. Six characters after folding; real Turkish ruhsat
 * engine numbers are ten to fourteen.
 */
const MIN_ENGINE_LENGTH = 6;

/** A storable engine number, or null when it is too short to identify anything. */
export function normalizeEngineNo(raw: string | null | undefined): string | null {
  const n = normalizeIdentifier(raw);
  return foldIdentity(n).length >= MIN_ENGINE_LENGTH ? n : null;
}

/**
 * Plate normalisation for DISPLAY and for within-garage matching only. Never a
 * registry key — see the module note. Spacing is stripped and the string is
 * uppercased; the Turkish plate GRAMMAR (and its OCR repair) lives in
 * ocr/validators.ts, which is where a scan is corrected before it gets here.
 */
export function normalizePlate(raw: string | null | undefined): string | null {
  const n = normalizeIdentifier(raw);
  return n.length > 0 ? n : null;
}

// ─── the registry ─────────────────────────────────────────────────────────────

/** The identity fields of a vehicle, as they arrive from a form or a scan. */
export interface IdentityInput {
  chassisNo?: string | null;
  engineNo?: string | null;
}

/** One resolved, storable identity. */
export interface ResolvedIdentity {
  kind: IdentityKind;
  /** What to show a human. */
  value: string;
  /** What to compare against. */
  matchKey: string;
}

/**
 * Everything about this input that can identify a vehicle, strongest first.
 * Chassis leads because a VIN settles the question and an engine number only
 * raises it — and every caller acts on the first hit, so the order IS the
 * policy.
 */
export function resolveIdentities(input: IdentityInput): ResolvedIdentity[] {
  const out: ResolvedIdentity[] = [];
  const chassis = normalizeChassis(input.chassisNo);
  if (chassis) out.push({ kind: "chassis", value: chassis, matchKey: foldIdentity(chassis) });
  const engine = normalizeEngineNo(input.engineNo);
  if (engine) out.push({ kind: "engine", value: engine, matchKey: foldIdentity(engine) });
  return out;
}

export interface IdentityMatch {
  bikeId: string;
  kind: IdentityKind;
  /** The identifier the CALLER supplied, echoed for their own reference. */
  identifierHint: string;
}

/**
 * Is this vehicle already in the system, and on what evidence?
 *
 * Global by design: the answer must not depend on who is asking, or the
 * duplicate rule would only hold inside one account and two strangers could each
 * hold the same car. `excludeBikeId` is for the edit path — a vehicle is not a
 * duplicate of itself.
 *
 * Returns the STRONGEST match. A chassis hit is reported as a chassis hit even
 * if the engine also matches, because the two mean different things downstream:
 * a chassis match is proof, an engine match is an invitation to ask.
 */
export function findIdentityMatch(
  db: DB,
  input: IdentityInput,
  excludeBikeId: string | null = null,
): IdentityMatch | null {
  for (const id of resolveIdentities(input)) {
    const row = db
      .prepare(
        `SELECT bike_id FROM vehicle_identity
          WHERE kind = ? AND match_key = ?${excludeBikeId ? " AND bike_id <> ?" : ""}
          ORDER BY created_at ASC LIMIT 1`,
      )
      .get(...(excludeBikeId ? [id.kind, id.matchKey, excludeBikeId] : [id.kind, id.matchKey])) as
      | { bike_id: string }
      | undefined;
    if (row) return { bikeId: row.bike_id, kind: id.kind, identifierHint: id.value };
  }
  return null;
}

/**
 * Write (or refresh) a vehicle's identity rows.
 *
 * `INSERT OR IGNORE` on the chassis row is doing real work: the unique index is
 * the actual guarantee, and a caller that checked for a duplicate a microsecond
 * earlier can still lose a race with a simultaneous add. Losing that race must
 * degrade to "this vehicle exists but does not hold the identity" — which is
 * exactly what the unclaimed-vehicle path already copes with — and never to a
 * 500 that leaves a half-created vehicle behind.
 *
 * Identities are only ever ADDED or REPLACED, never silently dropped: clearing a
 * chassis number on a record must not release the identity to the next person
 * who types it, or the uniqueness rule would be one edit away from being off.
 * `clearIdentity` is the explicit door for that, and only handover uses it.
 */
export function registerIdentities(db: DB, bikeId: string, input: IdentityInput): void {
  for (const id of resolveIdentities(input)) {
    db.prepare(
      `INSERT INTO vehicle_identity (bike_id, kind, match_key, value)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(bike_id, kind) DO UPDATE SET
         match_key = excluded.match_key,
         value = excluded.value`,
    ).run(bikeId, id.kind, id.matchKey, id.value);
  }
}

/**
 * The same write, but tolerant of the unique index rejecting a chassis. Used on
 * the paths where the caller has already decided that a duplicate is acceptable
 * (the unresponsive-holder fallback) or where failing would abort something more
 * important than the registry row (an OCR auto-apply).
 */
export function tryRegisterIdentities(db: DB, bikeId: string, input: IdentityInput): void {
  for (const id of resolveIdentities(input)) {
    try {
      db.prepare(
        `INSERT INTO vehicle_identity (bike_id, kind, match_key, value)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(bike_id, kind) DO UPDATE SET
           match_key = excluded.match_key,
           value = excluded.value`,
      ).run(bikeId, id.kind, id.matchKey, id.value);
    } catch {
      // The chassis is spoken for. The vehicle is still perfectly usable; it
      // simply is not the holder of record for that VIN.
    }
  }
}

/** Drop a vehicle's registry rows. Only handover and archival-fork use this. */
export function clearIdentities(db: DB, bikeId: string): void {
  db.prepare("DELETE FROM vehicle_identity WHERE bike_id = ?").run(bikeId);
}

/** The identities a vehicle currently holds — for the share/handover screens. */
export function identitiesOf(db: DB, bikeId: string): ResolvedIdentity[] {
  const rows = db
    .prepare("SELECT kind, value, match_key FROM vehicle_identity WHERE bike_id = ?")
    .all(bikeId) as { kind: IdentityKind; value: string; match_key: string }[];
  return rows.map((r) => ({ kind: r.kind, value: r.value, matchKey: r.match_key }));
}

// ─── the opaque claim capability ──────────────────────────────────────────────

/** How long the token handed out with a 409 stays usable. */
const CLAIM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export interface ClaimTokenRow {
  token: string;
  bike_id: string;
  user_id: string;
  matched_on: IdentityKind;
  identifier_hint: string;
  expires_at: string;
}

/**
 * Mint the handle a rejected "add vehicle" hands back.
 *
 * This is the privacy-critical piece of the duplicate flow. The caller must be
 * able to say "yes, ask that holder about it" WITHOUT ever learning which
 * vehicle they are talking about, so the token is an opaque random string stored
 * server-side rather than anything derived from the bike id. It is bound to the
 * user who hit the duplicate — a leaked token is useless to anyone else — and it
 * expires on its own, so a token harvested today cannot be replayed next month.
 */
export function mintClaimToken(
  db: DB,
  match: IdentityMatch,
  userId: string,
): { token: string; expiresAt: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CLAIM_TOKEN_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO vehicle_claim_token (token, bike_id, user_id, matched_on, identifier_hint, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(token, match.bikeId, userId, match.kind, match.identifierHint, expiresAt);
  return { token, expiresAt };
}

/** Redeem a token, for this user only. Null covers unknown, foreign and expired. */
export function readClaimToken(db: DB, token: string, userId: string): ClaimTokenRow | null {
  const row = db
    .prepare("SELECT * FROM vehicle_claim_token WHERE token = ? AND user_id = ?")
    .get(token, userId) as ClaimTokenRow | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  return row;
}

/** Housekeeping — tokens are single-purpose and short-lived. */
export function consumeClaimToken(db: DB, token: string): void {
  db.prepare("DELETE FROM vehicle_claim_token WHERE token = ?").run(token);
}

/**
 * A duplicate that is ALREADY in a garage the caller can reach is not a
 * duplicate conversation — it is the user photographing or re-typing their own
 * vehicle. The caller sees a normal "you already have this" answer and no claim
 * flow, because there is nobody to ask.
 */
export function bikeIsReachable(db: DB, userId: string, bikeId: string): boolean {
  // Imported lazily to keep this module free of a cycle with orgAccess, which
  // imports nothing from here.
  const row = db.prepare("SELECT 1 AS ok FROM bike WHERE id = ? AND user_id = ?").get(bikeId, userId) as
    | { ok: number }
    | undefined;
  if (row) return true;
  const org = db
    .prepare(
      `SELECT 1 AS ok FROM bike b
         JOIN org_member m ON m.org_id = b.org_id AND m.user_id = ? AND m.status = 'active'
        WHERE b.id = ?`,
    )
    .get(userId, bikeId) as { ok: number } | undefined;
  return !!org;
}
