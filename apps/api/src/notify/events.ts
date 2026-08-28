import type { Database as DB } from "better-sqlite3";
import { getDb } from "../db/index.js";
import { config } from "../config.js";
import { newId } from "../lib/ulid.js";
import { approversOfBike } from "../lib/orgAccess.js";
import { sendGarageInviteEmail } from "../auth/email.js";
import {
  asLang,
  claimAccessMessage,
  claimDecidedMessage,
  claimPurchaseMessage,
  DEFAULT_LANG,
  inviteEmailBody,
  type Lang,
  type Message,
} from "./messages.js";
import { pushToUser, Semaphore, PUSH_CONCURRENCY, type PushPayload } from "./send.js";

/**
 * EVENT-DRIVEN NOTIFICATIONS — the sharing layer's side of notify/.
 *
 * `dispatcher.ts` sends because the calendar moved. This file sends because a
 * person did something that another person is now waiting on. Four rules govern
 * everything below, and each of them is a bug that would otherwise be
 * discovered in production:
 *
 *  1. A SEND MUST NEVER BREAK THE ACTION. Approving a claim moves a real
 *     vehicle between two accounts. If APNs is down, or Resend rate-limits us,
 *     or a push endpoint hangs, the handover must still have happened and the
 *     caller must still get its 200. So nothing here is called inside the
 *     transaction that mutates ownership, nothing here is awaited by a route
 *     handler, and every entry point swallows its own failures.
 *
 *  2. A SEND MUST HAPPEN ONCE. A retried request, a double-tapped button, a
 *     client that fires the same POST twice on a flaky connection — none of
 *     them may reach the recipient twice. `notification_event` holds a UNIQUE
 *     (recipient, kind, subject_id, channel) and the slot is CLAIMED BEFORE the
 *     send, not recorded after it, so two concurrent attempts cannot both pass
 *     the check and then both deliver.
 *
 *  3. THE RESPONSE MUST NOT DEPEND ON WHO THE RECIPIENT IS. Awaiting a send
 *     inside a handler would make the invite route measurably slower for an
 *     address that has an account than one that does not, which is the email
 *     enumeration oracle the route was carefully built to avoid — reintroduced
 *     as a timing side channel. Everything is fire-and-forget.
 *
 *  4. A NOTIFICATION RUNS THE OPPOSITE WAY TO A DUPLICATE CHECK, AND MUST BE
 *     JUST AS CAREFUL. The 409 on a duplicate vehicle never says who holds it;
 *     a notification about that same collision travels TO the holder, and must
 *     not carry the requester's identity back on the lock screen — nor tell the
 *     requester anything about the holder. See notify/messages.ts.
 */

// ─── fire-and-forget, with a handle for tests ────────────────────────────────

/**
 * In-flight sends. A route hands a promise to `fireAndForget` and returns
 * immediately; the promise settles later, on its own.
 *
 * The set exists so the test suite can be deterministic without the routes
 * having to await anything. `await notificationsIdle()` drains it, including
 * sends that were themselves started by a send (there are none today, but a
 * one-shot drain that silently missed them would be a trap for whoever adds
 * the first). In production nothing ever calls it.
 */
const pending = new Set<Promise<unknown>>();

export function fireAndForget(work: () => Promise<void>): void {
  const p = (async () => {
    try {
      await work();
    } catch (e) {
      // The action this notification is about has already succeeded and been
      // reported to the caller. There is nothing to roll back and nobody to
      // tell, so it is logged and dropped.
      console.error("[notify:event] send failed", e);
    }
  })();
  pending.add(p);
  void p.finally(() => pending.delete(p));
}

/** Test helper: resolve once every queued send has settled. */
export async function notificationsIdle(): Promise<void> {
  for (let i = 0; i < 50 && pending.size > 0; i++) {
    await Promise.allSettled([...pending]);
    // Yield so the `finally` handlers above run before we re-read the set.
    await new Promise((r) => setImmediate(r));
  }
}

// ─── preferences ─────────────────────────────────────────────────────────────

export type EventKind =
  | "claim_access"
  | "claim_purchase"
  | "claim_approved"
  | "claim_declined"
  | "share_invite";

/**
 * Which sharing notifications the `sharing` preference may switch off.
 *
 * `claim_access` and `claim_purchase` are deliberately absent. Both are
 * requests about a vehicle the RECIPIENT holds, and both start a 21-day window
 * (CLAIM_RESPONSE_DAYS) after which the person who asked may open a competing
 * record of the vehicle. A settings toggle that could silence them would turn
 * an unanswered-holder fallback — designed around the holder having had a fair
 * chance to answer — into something that fires against a holder who was never
 * addressable. That is not a preference, it is a way to lose your car's record
 * by having tidied your notifications, so the toggle does not reach them.
 *
 * `share_invite` is absent for a completely different reason, and it is worth
 * being precise about which: it is not that an invitation is too important to
 * mute, it is that THERE IS NOBODY TO ASK. An invitation goes to an address,
 * and the whole point of the email path is the address that has no account and
 * therefore no preference row. Looking one up would mean branching on whether
 * the address is registered — which is the email enumeration oracle
 * `POST /groups/:id/invites` is built to avoid, reintroduced through the back
 * door. A muted invitation would also fail silently in the worst possible
 * direction: the inviter is told the invitation was created, and the invitee
 * never hears about it.
 *
 * So the toggle governs exactly one thing, and the Settings copy says exactly
 * that thing: answers to requests you sent.
 */
const MUTABLE_KINDS: ReadonlySet<EventKind> = new Set<EventKind>([
  "claim_approved",
  "claim_declined",
]);

/**
 * Has this user switched sharing notifications off? Absent row = on, matching
 * how the categories endpoint materialises defaults; the daily reminders
 * default the other way (no row = silence) because they are opt-in per item
 * type and this is a transactional category.
 */
function sharingMuted(db: DB, userId: string): boolean {
  const row = db
    .prepare(
      "SELECT enabled FROM notification_category_preference WHERE user_id = ? AND category = 'sharing'",
    )
    .get(userId) as { enabled: number } | undefined;
  return row?.enabled === 0;
}

function languageOf(db: DB, userId: string): Lang {
  const row = db.prepare("SELECT language FROM profile WHERE user_id = ?").get(userId) as
    | { language: string }
    | undefined;
  return row ? asLang(row.language) : DEFAULT_LANG;
}

// ─── idempotency ─────────────────────────────────────────────────────────────

/** A cooldown modifier that never elapses — i.e. "send this exactly once, ever". */
const NEVER_AGAIN = "-1000 years";

/**
 * Claim the right to send, atomically.
 *
 * Returns true when this caller — and only this caller — should now deliver.
 * The row is written BEFORE the send: a slot recorded afterwards leaves a
 * window in which two concurrent handlers both see "not sent yet" and both
 * deliver, which is exactly the double-notification this table exists to stop.
 *
 * `cooldown` is a negative SQLite datetime modifier and decides whether a
 * repeat is ever legitimate. For the claim events it is NEVER_AGAIN: a claim is
 * created once and decided once, so a second attempt is always a replay. For an
 * invitation email it is a real window, because re-inviting somebody after
 * their link expired is a thing people do on purpose — the window only stops
 * the accidental version of it (a double tap, a retried request).
 */
function claimSlot(input: {
  db: DB;
  recipient: string;
  userId: string | null;
  actorId: string | null;
  kind: EventKind;
  subjectId: string;
  channel: "push" | "email";
  cooldown?: string;
}): string | null {
  const id = newId();
  const res = input.db
    .prepare(
      `INSERT INTO notification_event (id, recipient, user_id, actor_id, kind, subject_id, channel, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (recipient, kind, subject_id, channel) DO UPDATE
         SET id = excluded.id, actor_id = excluded.actor_id, sent_at = excluded.sent_at
       WHERE notification_event.sent_at <= datetime('now', ?)`,
    )
    .run(
      id,
      input.recipient,
      input.userId,
      input.actorId,
      input.kind,
      input.subjectId,
      input.channel,
      input.cooldown ?? NEVER_AGAIN,
    );
  return res.changes > 0 ? id : null;
}

/**
 * Hand the slot back after a send that reached nobody.
 *
 * Only for a total failure — no endpoint accepted the payload and none was
 * reported dead. Anything else (a partial success, or an endpoint the push
 * service says is gone) is a delivery that happened or a recipient who has no
 * working device, and re-arming either would eventually mean sending the same
 * thing twice.
 */
function releaseSlot(db: DB, id: string): void {
  db.prepare("DELETE FROM notification_event WHERE id = ?").run(id);
}

// ─── the push path ───────────────────────────────────────────────────────────

async function pushEvent(input: {
  db: DB;
  userId: string;
  kind: EventKind;
  subjectId: string;
  message: Message;
  url: string;
  actorId?: string | null;
}): Promise<void> {
  const { db, userId, kind, subjectId } = input;
  if (MUTABLE_KINDS.has(kind) && sharingMuted(db, userId)) return;

  const slot = claimSlot({
    db,
    recipient: userId,
    userId,
    actorId: input.actorId ?? null,
    kind,
    subjectId,
    channel: "push",
  });
  if (!slot) return;

  const payload: PushPayload = {
    title: input.message.title,
    body: input.message.body,
    url: input.url,
    // One notification per event, so a device that receives it twice (a
    // resubscribed endpoint, a re-registered APNs token) collapses it.
    tag: `${kind}:${subjectId}`,
  };
  const outcome = await pushToUser(userId, payload, new Semaphore(PUSH_CONCURRENCY));
  if (!outcome.anyOk && outcome.expired === 0) releaseSlot(db, slot);
}

/** Deliver one payload to several recipients, bounded, never failing as a whole. */
async function pushToAll(
  db: DB,
  userIds: string[],
  build: (lang: Lang) => Message,
  common: { kind: EventKind; subjectId: string; url: string; actorId?: string | null },
): Promise<void> {
  await Promise.allSettled(
    userIds.map((userId) =>
      pushEvent({
        db,
        userId,
        message: build(languageOf(db, userId)),
        ...common,
      }),
    ),
  );
}

// ─── events ──────────────────────────────────────────────────────────────────

/** Where a holder decides a claim: the vehicle list carries the claim inbox. */
const CLAIM_INBOX_URL = "/bikes";

interface ClaimRow {
  id: string;
  bike_id: string;
  requester_id: string;
  kind: "access" | "purchase";
  identifier_hint: string;
  expires_at: string;
}

/**
 * Somebody filed a claim against a vehicle. Told to `approversOfBike` — the one
 * definition in the app of "who may decide this" (lib/orgAccess.ts), reused
 * here rather than re-derived, so the set of people who are ASKED can never
 * drift from the set of people who CAN ANSWER.
 *
 * The requester is not in that set by construction: they do not hold the
 * vehicle, which is the entire reason they are asking.
 */
export function notifyClaimCreated(claimId: string): void {
  fireAndForget(async () => {
    const db = getDb();
    const claim = db
      .prepare(
        "SELECT id, bike_id, requester_id, kind, identifier_hint, expires_at FROM vehicle_claim WHERE id = ?",
      )
      .get(claimId) as ClaimRow | undefined;
    if (!claim) return;
    const bike = db.prepare("SELECT nickname FROM bike WHERE id = ?").get(claim.bike_id) as
      | { nickname: string }
      | undefined;
    if (!bike) return;

    // Whole days left, rounded up, so "21 gün" is what a holder reads on the
    // day the claim lands rather than "20".
    const days = Math.max(
      1,
      Math.ceil((new Date(claim.expires_at).getTime() - Date.now()) / 86400_000),
    );
    const kind: EventKind = claim.kind === "purchase" ? "claim_purchase" : "claim_access";

    await pushToAll(
      db,
      approversOfBike(claim.bike_id, db).filter((id) => id !== claim.requester_id),
      (lang) =>
        claim.kind === "purchase"
          ? claimPurchaseMessage(lang, bike.nickname, days)
          : claimAccessMessage(lang, bike.nickname),
      {
        kind,
        subjectId: claim.id,
        url: CLAIM_INBOX_URL,
        actorId: claim.requester_id,
      },
    );
  });
}

/**
 * A claim was answered. Told to the requester and to nobody else — the
 * approvers took the decision and do not need to be told what they just did.
 *
 * The message carries only the identifier the requester typed themselves. Not
 * the vehicle's nickname, not its plate, and nothing about who answered: a
 * DECLINE especially must leave the requester exactly as ignorant of the holder
 * as they were before they asked, or "we never tell you who holds it" becomes
 * "we never tell you who holds it unless you provoke a refusal".
 */
export function notifyClaimDecided(claimId: string, decision: "approved" | "declined"): void {
  fireAndForget(async () => {
    const db = getDb();
    const claim = db
      .prepare("SELECT id, requester_id, identifier_hint FROM vehicle_claim WHERE id = ?")
      .get(claimId) as { id: string; requester_id: string; identifier_hint: string } | undefined;
    if (!claim) return;
    await pushEvent({
      db,
      userId: claim.requester_id,
      kind: decision === "approved" ? "claim_approved" : "claim_declined",
      subjectId: claim.id,
      message: claimDecidedMessage(languageOf(db, claim.requester_id), decision, claim.identifier_hint),
      url: CLAIM_INBOX_URL,
    });
  });
}

// ─── invitations ─────────────────────────────────────────────────────────────

/**
 * How long one address must wait before this garage may mail it again.
 *
 * Not an idempotency key — re-inviting somebody is legitimate and the UI offers
 * it — but the accidental repeat (a double tap, a retried POST on a flaky
 * connection) is not, and neither is a script re-issuing invitations in a loop
 * to keep an address ringing.
 */
const INVITE_EMAIL_COOLDOWN = "-10 minutes";

/**
 * How many invitation emails one account may cause in a rolling day.
 *
 * The express-rate-limit on the route (lib/shareLimits.ts) is the first line
 * and the better one for bursts, but it is in-memory: it resets on every deploy
 * and is per-process. This is the durable ceiling, and it is the one that
 * matters for the actual risk here — not a burst, but a steady trickle of mail
 * leaving our sending domain to addresses that never asked for it. A domain
 * that lands in spam folders takes the sign-in and password-reset mail down
 * with it.
 *
 * Twenty is far above any honest use (a garage holds MAX_SHARE_MEMBERS = 8, and
 * a person has MAX_SHARE_GROUPS = 10 of them, filled once and not daily) and
 * far below anything worth doing as a spammer.
 */
const MAX_INVITE_EMAILS_PER_DAY = 20;

function inviteEmailsSentToday(db: DB, actorId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM notification_event
          WHERE actor_id = ? AND channel = 'email' AND kind = 'share_invite'
            AND sent_at > datetime('now', '-1 day')`,
      )
      .get(actorId) as { n: number }
  ).n;
}

/**
 * The invitee's accept link.
 *
 * Same shape the app itself produces (components/share/ShareInviteAccept.tsx):
 * a query parameter on a route that already exists, consumed and stripped from
 * the address bar the moment the sheet opens. The token is a bearer credential
 * and it is stored only as a SHA-256 digest, generated from a CSPRNG, and
 * checked with a constant-time compare — none of which this changes; the link
 * we mail is byte-for-byte the link the inviter would otherwise have copied out
 * of the app and pasted into a message themselves.
 */
function acceptUrl(token: string): string {
  return `${config.APP_BASE_URL}/bikes?shareInvite=${encodeURIComponent(token)}`;
}

/**
 * Somebody was invited into a garage.
 *
 * Mail, unconditionally, to the address that was typed — see
 * auth/email.ts:sendGarageInviteEmail for why this does NOT branch on whether
 * the address has an account, and notify/messages.ts:inviteEmailBody for why
 * the message names neither the garage nor the person inviting.
 *
 * LANGUAGE. An invitee has no profile, and may have no account at all, so there
 * is nothing to read a language from. The inviter's language is the best signal
 * available — people invite their own household and their own mechanic — and it
 * falls back to DEFAULT_LANG ('tr', the market the app ships for), which is
 * also what the existing sign-in and password-reset mail uses unconditionally.
 */
export function notifyGarageInvite(input: {
  orgId: string;
  email: string;
  token: string;
  actorId: string;
  ttlDays: number;
}): void {
  fireAndForget(async () => {
    const db = getDb();
    const recipient = input.email.trim().toLowerCase();

    if (inviteEmailsSentToday(db, input.actorId) >= MAX_INVITE_EMAILS_PER_DAY) {
      console.warn(`[notify:event] invite email cap reached for actor ${input.actorId}`);
      return;
    }

    const slot = claimSlot({
      db,
      recipient,
      // No user reference: the whole point of this path is the invitee who does
      // not have an account. Looking one up to attach it would reintroduce the
      // account-existence branch this design removes.
      userId: null,
      actorId: input.actorId,
      kind: "share_invite",
      // The GARAGE, not the invitation row — a re-invite mints a fresh invite id
      // every time, so keying on it would make the cooldown unenforceable.
      subjectId: input.orgId,
      channel: "email",
      cooldown: INVITE_EMAIL_COOLDOWN,
    });
    if (!slot) return;

    const url = acceptUrl(input.token);
    const lang = languageOf(db, input.actorId);
    try {
      await sendGarageInviteEmail(recipient, inviteEmailBody(lang, url, input.ttlDays), url);
    } catch (e) {
      // Let a later attempt through: a provider outage must not consume the
      // one invitation this address was ever going to get.
      releaseSlot(db, slot);
      throw e;
    }
  });
}

// ─── what is deliberately NOT sent ───────────────────────────────────────────
//
// "A MEMBER JOINED / LEFT YOUR GARAGE." Considered and rejected, on the
// grounds that a channel people mute is strictly worse than one that does not
// exist — and these two would be the ones that taught them to mute it.
//
//   - A join is not news. The owner is the only person who can invite, so the
//     join is the completion of something they started, to an address they
//     typed, usually within minutes and usually in the same room. The
//     notification arrives to tell them what they already know.
//   - A departure is not urgent. Nothing expires, nobody is waiting on an
//     answer, and the member list on the sharing screen is authoritative the
//     next time it is opened. There is no decision to make.
//   - Both are frequent in exactly the households that use the feature most —
//     a family garage churns members while people swap cars — so they would be
//     the bulk of the volume in this category by some margin.
//
// The rule this follows: notify when somebody is WAITING ON THE RECIPIENT, or
// when the recipient is waiting on somebody and the answer has arrived. Every
// event above satisfies it; a membership change satisfies neither.
//
// "YOUR OPEN CLAIM WAS EXPIRED BY A HANDOVER." `handoverVehicle` closes the
// other pending claims on a vehicle that has just moved. Left silent for now:
// the outgoing-claims screen already shows the state, and the requester is not
// owed a push saying a stranger they were never told about sold to somebody
// else. Revisit if it turns out people sit on a dead claim.
//
// "FLEET INVITATIONS." Not routed through here. `routes/orgMembers.ts` issues
// invitations for BUSINESS organizations, which are provisioned offline by the
// operator and whose invitees are employees being onboarded by a manager
// standing next to them; docs/fleet-design.md §1 also keeps fleet invisible to
// consumers, and unsolicited mail from our domain naming a company to a
// possibly-mistyped address is the wrong first contact for that product. The
// manager still sends the link, exactly as before.
