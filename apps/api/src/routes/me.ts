import { Router } from "express";
import { z } from "zod";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";

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
