import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { norm } from "../ocr/catalog.js";

/**
 * Read-only motorcycle catalog, backing make/model autocomplete in the review
 * UI. Data is seeded from the bundled catalog (see db/seedCatalog.ts).
 */
export const catalogRouter: Router = Router();
catalogRouter.use(requireUser);

/** Optional ?type=car|motorcycle filter, ignored if anything else. */
function typeFilter(req: { query: Record<string, unknown> }): "car" | "motorcycle" | null {
  const t = req.query.type;
  return t === "car" || t === "motorcycle" ? t : null;
}

// GET /api/catalog/makes?q=ya&type=car  → up to 50 make names, prefix-then-substring ranked
catalogRouter.get(
  "/makes",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const q = typeof req.query.q === "string" ? norm(req.query.q) : "";
    const type = typeFilter(req);
    const typeClause = type ? "AND types LIKE ?" : "";
    const typeArg = type ? [`%${type}%`] : [];
    if (!q) {
      const rows = db
        .prepare(`SELECT name FROM vehicle_make WHERE 1=1 ${typeClause} ORDER BY (source='overlay') DESC, name ASC LIMIT 50`)
        .all(...typeArg) as { name: string }[];
      res.json(rows.map((r) => r.name));
      return;
    }
    const rows = db
      .prepare(
        `SELECT name, norm FROM vehicle_make
          WHERE norm LIKE ? ${typeClause}
          ORDER BY (norm = ?) DESC, (norm LIKE ?) DESC, (source='overlay') DESC, length(name) ASC
          LIMIT 50`,
      )
      .all(`%${q}%`, ...typeArg, q, `${q}%`) as { name: string; norm: string }[];
    res.json(rows.map((r) => r.name));
  }),
);

// GET /api/catalog/models?make=Yamaha&q=mt&type=motorcycle → up to 50 model names
catalogRouter.get(
  "/models",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const makeNorm = typeof req.query.make === "string" ? norm(req.query.make) : "";
    if (!makeNorm) {
      res.json([]);
      return;
    }
    // Resolve make by norm or alias. Prefer a curated overlay make / alias
    // target over a bare vPIC make that happens to share the normalized name
    // (e.g. "harley" → the Harley-Davidson alias, not a stray vPIC "Harley").
    const make = db
      .prepare(
        `SELECT id FROM (
            SELECT m.id AS id, (m.source = 'overlay') AS pri
              FROM vehicle_make m WHERE m.norm = ?
            UNION ALL
            SELECT a.make_id AS id, 2 AS pri
              FROM vehicle_make_alias a WHERE a.norm = ?
          ) ORDER BY pri DESC LIMIT 1`,
      )
      .get(makeNorm, makeNorm) as { id: number } | undefined;
    if (!make) {
      res.json([]);
      return;
    }
    const q = typeof req.query.q === "string" ? norm(req.query.q) : "";
    const type = typeFilter(req);
    const typeClause = type ? "AND type = ?" : "";
    const typeArg = type ? [type] : [];
    const rows = q
      ? (db
          .prepare(
            `SELECT name FROM vehicle_model WHERE make_id = ? AND norm LIKE ? ${typeClause}
              ORDER BY (norm LIKE ?) DESC, length(name) ASC LIMIT 50`,
          )
          .all(make.id, `%${q}%`, ...typeArg, `${q}%`) as { name: string }[])
      : (db
          .prepare(`SELECT name FROM vehicle_model WHERE make_id = ? ${typeClause} ORDER BY name ASC LIMIT 50`)
          .all(make.id, ...typeArg) as { name: string }[]);
    res.json(rows.map((r) => r.name));
  }),
);
