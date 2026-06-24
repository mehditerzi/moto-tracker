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

const deleteSchema = z.object({ password: z.string().min(1) });

// Permanent account deletion (App Store Guideline 5.1.1(v)). The user is
// already authenticated; re-entering the password is the confirmation gate.
meRouter.delete(
  "/",
  asyncHandler(async (req, res) => {
    const { password } = deleteSchema.parse(req.body);

    // Verify the password via better-auth — it throws on bad credentials.
    try {
      await getAuth().api.signInEmail({ body: { email: req.user!.email, password } });
    } catch {
      res.status(401).json({ error: "invalid_password" });
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
