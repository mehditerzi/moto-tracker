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

/**
 * `norm LIKE '%q%'` has a leading wildcard, so no b-tree index can serve it and
 * every keystroke scans the whole make table. vehicle_make_fts (FTS5, trigram
 * tokenizer — see migration 020) answers exactly the same substring predicate
 * from an index, so we narrow to the matching ids first and keep the ranking
 * ORDER BY untouched. Trigrams need at least 3 characters; below that FTS5
 * falls back to a linear scan of its own index, so we keep the plain scan for
 * 1–2 character queries (cheaper, and the result set is identical either way).
 */
const FTS_MIN_CHARS = 3;
function makeMatchClause(q: string): string {
  return q.length >= FTS_MIN_CHARS
    ? "id IN (SELECT rowid FROM vehicle_make_fts WHERE norm LIKE ?)"
    : "norm LIKE ?";
}

/**
 * Popularity in the Turkish market, curated in scripts/fetch-moto-catalog.mjs
 * and seeded by migration 026. Ranks live in a column per vehicle type because
 * the two overlays are ranked independently — Honda is first among motorcycles
 * and mid-table among cars — so a single column would have floated it to the
 * top of both lists. With no type filter, the better of the two stands in.
 *
 * Uncurated rows (vPIC breadth) are 0 and therefore sort last, exactly where
 * the previous alphabetical-only ordering already put them relative to the
 * overlay.
 */
function makePopExpr(type: "car" | "motorcycle" | null): string {
  if (type === "car") return "pop_car";
  if (type === "motorcycle") return "pop_moto";
  return "MAX(pop_car, pop_moto)";
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
    const pop = makePopExpr(type);
    if (!q) {
      // Opening the dropdown with nothing typed is the tap-saving path: it must
      // answer with the brands this market actually drives, not the alphabet.
      const rows = db
        .prepare(
          `SELECT name FROM vehicle_make WHERE 1=1 ${typeClause}
            ORDER BY ${pop} DESC, (source='overlay') DESC, name ASC LIMIT 50`,
        )
        .all(...typeArg) as { name: string }[];
      res.json(rows.map((r) => r.name));
      return;
    }
    // Match quality still outranks popularity — an exact hit, then a prefix hit
    // — so typing never fights the ranking. Popularity only breaks ties, which
    // is precisely where `length(name)` used to decide alone.
    const rows = db
      .prepare(
        `SELECT name, norm FROM vehicle_make
          WHERE ${makeMatchClause(q)} ${typeClause}
          ORDER BY (norm = ?) DESC, (norm LIKE ?) DESC, ${pop} DESC, (source='overlay') DESC, length(name) ASC
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
    // Same contract as /makes: prefix beats substring, then popularity, then
    // the shortest name. With no query the list opens on the make's common
    // models (Renault → Clio, Megane, Symbol) rather than alphabetically.
    const rows = q
      ? (db
          .prepare(
            `SELECT name FROM vehicle_model WHERE make_id = ? AND norm LIKE ? ${typeClause}
              ORDER BY (norm LIKE ?) DESC, popularity DESC, length(name) ASC LIMIT 50`,
          )
          .all(make.id, `%${q}%`, ...typeArg, `${q}%`) as { name: string }[])
      : (db
          .prepare(
            `SELECT name FROM vehicle_model WHERE make_id = ? ${typeClause}
              ORDER BY popularity DESC, name ASC LIMIT 50`,
          )
          .all(make.id, ...typeArg) as { name: string }[]);
    res.json(rows.map((r) => r.name));
  }),
);
