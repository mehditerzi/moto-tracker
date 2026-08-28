import type { Database as DB } from "better-sqlite3";
import { newId } from "./ulid.js";
import { canAddVehicle } from "./entitlement.js";

/**
 * Ownership handover: moving a vehicle to the person who owns it now.
 *
 * ONE product decision drives every line of this file, and it is not
 * negotiable:
 *
 *   THE VEHICLE'S HISTORY IS ABOUT THE CAR. THE TRIPS, THE DOCUMENTS AND THE
 *   SPENDING ARE ABOUT THE PERSON.
 *
 * So the buyer inherits the service records, the odometer, the renewal deadlines
 * (muayene / sigorta / kasko / MTV) and the identity fields — which is the whole
 * reason anyone wants this: a used car arrives with its maintenance history
 * intact instead of a blank page. And the seller keeps their GPS trips, their
 * fuel logs, their scanned documents and their photos.
 *
 * That second half is a legal requirement, not a preference. A scanned Turkish
 * ruhsat carries the previous owner's **TC kimlik number, name and home
 * address**; a trip log is everywhere they drove; a fuel log is what they spent
 * and where. Handing any of it to the stranger who bought the car is a KVKK
 * disclosure with no lawful basis. There is no setting for it.
 *
 * ── HOW THE SPLIT IS ACTUALLY PERFORMED ──────────────────────────────────────
 *
 * `trip.bike_id` and `fuel_log.bike_id` are NOT NULL, so "detach them" is not
 * available; and even if it were, a trip with no vehicle is a worse record than
 * one with the wrong vehicle. Instead the seller's personal layer is FORKED onto
 * an archived copy of the vehicle in their own garage — "Corolla (önceki)" —
 * which keeps their history readable and correctly attributed while the live
 * record moves on. The fork:
 *
 *   - is `archived = 1`, so it costs the seller nothing against their vehicle
 *     ceiling (`countActiveBikes` filters archived rows);
 *   - is `org_id = NULL`, so it leaves any garage group the vehicle was shared
 *     into — the seller's history is not the group's business;
 *   - carries NO chassis, engine or plate, so it cannot contest the identity
 *     registry and cannot be mistaken for the vehicle itself.
 *
 * A fork is made per DISTINCT AUTHOR, not just for the custodian. On a shared
 * vehicle a group member may have logged their own fills; those are theirs too,
 * and they must not travel to the buyer either.
 */

export interface HandoverInput {
  db: DB;
  bikeId: string;
  toUserId: string;
  claimId?: string | null;
  source: "claim_approved" | "holder_initiated";
}

export type HandoverResult =
  | { ok: true; handoverId: string; fromUserId: string; forkedFor: string[] }
  | { ok: false; error: "bike_not_found" | "vehicle_limit_reached" | "same_owner" };

interface BikeRow {
  id: string;
  user_id: string;
  org_id: string | null;
  vehicle_type: string;
  nickname: string;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  photo_url: string | null;
}

/** Suffix for the seller's archived copy. Bilingual apps localise on the client;
 *  this is stored text, so it stays in the app's primary language. */
const FORK_SUFFIX = "(önceki)";

/**
 * Perform the handover. Everything happens in one transaction: a half-moved
 * vehicle — identity in one account, service history in another — would be worse
 * than either outcome.
 */
export function handoverVehicle(input: HandoverInput): HandoverResult {
  const { db, bikeId, toUserId, source } = input;

  const bike = db
    .prepare(
      `SELECT id, user_id, org_id, vehicle_type, nickname, make, model, year, color, photo_url
         FROM bike WHERE id = ?`,
    )
    .get(bikeId) as BikeRow | undefined;
  if (!bike) return { ok: false, error: "bike_not_found" };
  if (bike.user_id === toUserId && bike.org_id === null) return { ok: false, error: "same_owner" };

  // THE ANTI-FARMING GATE. A handover is the ONE path by which a vehicle someone
  // else was paying for becomes yours, so it is also the one place the sharing
  // system could be used to acquire capacity for free. Receiving a vehicle costs
  // a slot exactly as adding one does.
  //
  // Checked before anything is written, and against the RECIPIENT: the seller's
  // ceiling is irrelevant (they are losing a vehicle, which can only help them).
  if (!canAddVehicle(toUserId, db)) return { ok: false, error: "vehicle_limit_reached" };

  const fromUserId = bike.user_id;
  const handoverId = newId();
  const forkedFor: string[] = [];

  const run = db.transaction(() => {
    // ── 1. who has a personal layer on this vehicle? ────────────────────────
    //
    // Usually just the custodian. On a shared vehicle it can also be a group
    // member who logged their own fills, and their records are no more the
    // buyer's business than the seller's are.
    const authors = db
      .prepare(
        `SELECT DISTINCT user_id FROM (
           SELECT user_id FROM trip     WHERE bike_id = ?
           UNION SELECT user_id FROM fuel_log WHERE bike_id = ?
           UNION SELECT user_id FROM document WHERE bike_id = ?
         )
         WHERE user_id <> ?`,
      )
      .all(bikeId, bikeId, bikeId, toUserId) as { user_id: string }[];

    for (const { user_id: authorId } of authors) {
      const forkId = newId();
      // Identity fields are omitted deliberately — see the module note. The
      // fork is a memento of a car, not a claim on one.
      db.prepare(
        `INSERT INTO bike (id, user_id, org_id, vehicle_type, nickname, make, model, year, color, photo_url, archived)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 1)`,
      ).run(
        forkId,
        authorId,
        bike.vehicle_type,
        `${bike.nickname} ${FORK_SUFFIX}`.slice(0, 80),
        bike.make,
        bike.model,
        bike.year,
        bike.color,
        // Only the custodian's fork inherits the photo file: the image lives at
        // one path on disk and two rows pointing at it would make the first
        // deletion break the second. Everyone else's fork is photoless.
        authorId === fromUserId ? bike.photo_url : null,
      );
      db.prepare("UPDATE trip SET bike_id = ? WHERE bike_id = ? AND user_id = ?").run(
        forkId,
        bikeId,
        authorId,
      );
      db.prepare("UPDATE fuel_log SET bike_id = ? WHERE bike_id = ? AND user_id = ?").run(
        forkId,
        bikeId,
        authorId,
      );
      db.prepare("UPDATE document SET bike_id = ? WHERE bike_id = ? AND user_id = ?").run(
        forkId,
        bikeId,
        authorId,
      );
      forkedFor.push(authorId);
    }

    // ── 2. sever the facts from the seller's documents ──────────────────────
    //
    // A renewal date scanned from the seller's insurance policy keeps a
    // `source_document_id` pointing at a file that has just moved into the
    // seller's archive. The date itself is a fact about the car and stays; the
    // POINTER must not, or the buyer's API responses would carry ids belonging
    // to documents they can never open — an invitation to probe.
    db.prepare("UPDATE dated_item SET source_document_id = NULL WHERE bike_id = ?").run(bikeId);

    // ── 3. reattribute the facts ────────────────────────────────────────────
    //
    // `dated_item.user_id` and `maintenance_item.user_id` CASCADE from user(id).
    // Leaving them pointing at the seller would mean the buyer's service history
    // silently vanished the day the seller deleted their account — which defeats
    // the entire purpose of preserving it. Authorship of "muayene expires on
    // 2027-03-14" is not sensitive; it is a fact about the car.
    db.prepare("UPDATE dated_item SET user_id = ? WHERE bike_id = ?").run(toUserId, bikeId);
    db.prepare("UPDATE maintenance_item SET user_id = ? WHERE bike_id = ?").run(toUserId, bikeId);

    // ── 4. move the vehicle ─────────────────────────────────────────────────
    //
    // `org_id = NULL` is not incidental: a sold car leaves the seller's garage
    // group. Anything else would leave the seller's family reading the buyer's
    // odometer. The buyer can share it again on their own terms.
    //
    // The photo is dropped from the live row for the same reason a photo does
    // not transfer at all: it is the seller's picture, often of their driveway.
    db.prepare(
      `UPDATE bike
          SET user_id = ?, org_id = NULL, photo_url = NULL, updated_at = datetime('now')
        WHERE id = ?`,
    ).run(toUserId, bikeId);

    // ── 5. close the conversation ───────────────────────────────────────────
    //
    // Every other open claim on this vehicle is about a holder who no longer
    // holds it. Expiring them stops the new owner inheriting a stranger's inbox.
    db.prepare(
      `UPDATE vehicle_claim
          SET status = 'expired', decided_at = datetime('now')
        WHERE bike_id = ? AND status = 'pending'${input.claimId ? " AND id <> ?" : ""}`,
    ).run(...(input.claimId ? [bikeId, input.claimId] : [bikeId]));
    db.prepare("DELETE FROM vehicle_claim_token WHERE bike_id = ?").run(bikeId);

    db.prepare(
      `INSERT INTO vehicle_handover (id, bike_id, from_user_id, to_user_id, claim_id, source)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(handoverId, bikeId, fromUserId, toUserId, input.claimId ?? null, source);
  });

  run();
  return { ok: true, handoverId, fromUserId, forkedFor };
}
