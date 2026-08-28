import { Router } from "express";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { getAuth } from "../auth/index.js";
import { config } from "../config.js";

export const meRouter: Router = Router();

interface ProfileRow {
  user_id: string;
  language: "tr" | "en";
  timezone: string;
  created_at: string;
}

/**
 * True when the user signed up with an email + password. Magic-link, Google and
 * Sign in with Apple users have no `credential` account row, so there is no
 * password to re-enter — they get the typed-confirmation gate instead.
 */
function hasPasswordAccount(userId: string): boolean {
  return (
    getDb()
      .prepare("SELECT 1 FROM account WHERE userId = ? AND providerId = 'credential'")
      .get(userId) !== undefined
  );
}

function getOrCreateProfile(userId: string): ProfileRow {
  const db = getDb();
  const existing = db
    .prepare("SELECT user_id, language, timezone, created_at FROM profile WHERE user_id = ?")
    .get(userId) as ProfileRow | undefined;
  if (existing) return existing;
  db.prepare(
    "INSERT INTO profile (user_id, language, timezone) VALUES (?, 'tr', 'Europe/Istanbul')",
  ).run(userId);
  return db
    .prepare("SELECT user_id, language, timezone, created_at FROM profile WHERE user_id = ?")
    .get(userId) as ProfileRow;
}

meRouter.use(requireUser);

meRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const profile = getOrCreateProfile(req.user!.id);
    res.json({
      user: {
        id: req.user!.id,
        email: req.user!.email,
        name: req.user!.name,
        image: null,
        // Lets the client pick the right account-deletion gate (password
        // re-entry vs. typed confirmation) without a second round-trip.
        hasPassword: hasPasswordAccount(req.user!.id),
      },
      profile: {
        userId: profile.user_id,
        language: profile.language,
        timezone: profile.timezone,
        createdAt: profile.created_at,
      },
    });
  }),
);

const patchSchema = z.object({
  language: z.enum(["tr", "en"]).optional(),
  timezone: z.string().min(1).optional(),
});

meRouter.patch(
  "/",
  asyncHandler(async (req, res) => {
    const body = patchSchema.parse(req.body);
    const db = getDb();
    getOrCreateProfile(req.user!.id);
    const sets: string[] = [];
    const values: (string | number)[] = [];
    if (body.language) {
      sets.push("language = ?");
      values.push(body.language);
    }
    if (body.timezone) {
      sets.push("timezone = ?");
      values.push(body.timezone);
    }
    if (sets.length) {
      values.push(req.user!.id);
      db.prepare(`UPDATE profile SET ${sets.join(", ")} WHERE user_id = ?`).run(...values);
    }
    const profile = getOrCreateProfile(req.user!.id);
    res.json({
      userId: profile.user_id,
      language: profile.language,
      timezone: profile.timezone,
      createdAt: profile.created_at,
    });
  }),
);

/** Typed confirmation phrase for accounts that have no password to re-enter. */
const DELETE_CONFIRM_PHRASE = "DELETE";

// Either gate, never both: password holders re-enter their password, everyone
// else types the confirmation phrase. Which one applies is decided server-side
// from the account rows, so a client can't pick the weaker one.
const deleteSchema = z.union([
  z.object({ password: z.string().min(1) }),
  z.object({ confirm: z.literal(DELETE_CONFIRM_PHRASE) }),
]);

// Permanent account deletion (App Store Guideline 5.1.1(v)). The user is
// already authenticated; the gate below is the confirmation step.
meRouter.delete(
  "/",
  asyncHandler(async (req, res) => {
    const hasPassword = hasPasswordAccount(req.user!.id);
    const parsed = deleteSchema.safeParse(req.body);
    // A malformed body is reported as "the gate you owe me is missing", which is
    // the only actionable thing the client can do about it.
    if (!parsed.success) {
      res.status(400).json({ error: hasPassword ? "password_required" : "confirmation_required" });
      return;
    }
    const body = parsed.data;

    if (hasPassword) {
      if (!("password" in body)) {
        // Password holders can't downgrade themselves to the typed phrase.
        res.status(400).json({ error: "password_required" });
        return;
      }
      // Verify the password via better-auth — it throws on bad credentials.
      try {
        await getAuth().api.signInEmail({
          body: { email: req.user!.email, password: body.password },
        });
      } catch {
        res.status(401).json({ error: "invalid_password" });
        return;
      }
    } else if (!("confirm" in body)) {
      // Passwordless (magic link / Google / Apple): signInEmail would always
      // throw "Credential account not found", so the phrase is the only gate.
      res.status(400).json({ error: "confirmation_required" });
      return;
    }

    // foreign_keys = ON + ON DELETE CASCADE on user(id) wipes session, account,
    // bike, dated_item, maintenance_item, document, profile,
    // notification_preference, notification_sent, push_subscription and
    // device_token in a single statement.
    getDb().prepare("DELETE FROM user WHERE id = ?").run(req.user!.id);

    // Uploaded document files live on disk, outside the DB — best-effort remove.
    try {
      fs.rmSync(path.join(config.UPLOADS_DIR, req.user!.id), { recursive: true, force: true });
    } catch {
      // The account row is already gone; orphaned files are harmless.
    }

    res.status(204).end();
  }),
);
