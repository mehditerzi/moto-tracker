/**
 * Load the bundled vehicle catalog (vehicleCatalog.generated.ts) into the
 * vehicle_make / vehicle_model tables. Idempotent: keyed on a fingerprint of
 * the catalog size so it only rebuilds when the bundled data actually changes.
 * Runs at startup after migrations.
 */
import type { Database as DB } from "better-sqlite3";
import { getDb } from "./index.js";
import { VEHICLE_CATALOG } from "./seed/vehicleCatalog.generated.js";

const FINGERPRINT_KEY = "catalog_fingerprint";

function fingerprint(): string {
  const makes = VEHICLE_CATALOG.length;
  const models = VEHICLE_CATALOG.reduce((s, m) => s + m.models.length, 0);
  return `v2:${makes}:${models}`;
}

export function seedCatalog(db: DB = getDb()): { seeded: boolean; makes: number; models: number } {
  db.exec(
    `CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  );
  const fp = fingerprint();
  const current = db
    .prepare("SELECT value FROM app_meta WHERE key = ?")
    .get(FINGERPRINT_KEY) as { value: string } | undefined;
  if (current?.value === fp) {
    return { seeded: false, makes: 0, models: 0 };
  }

  const insMake = db.prepare(
    "INSERT INTO vehicle_make (name, norm, source, types) VALUES (?, ?, ?, ?) ON CONFLICT(norm) DO UPDATE SET name = excluded.name, source = excluded.source, types = excluded.types RETURNING id",
  );
  const insAlias = db.prepare(
    "INSERT OR IGNORE INTO vehicle_make_alias (make_id, norm) VALUES (?, ?)",
  );
  const insModel = db.prepare(
    "INSERT OR IGNORE INTO vehicle_model (make_id, name, norm, type) VALUES (?, ?, ?, ?)",
  );

  let makes = 0;
  let models = 0;
  const tx = db.transaction(() => {
    // Full rebuild so renamed/removed entries don't linger.
    db.exec("DELETE FROM vehicle_model; DELETE FROM vehicle_make_alias; DELETE FROM vehicle_make;");
    for (const m of VEHICLE_CATALOG) {
      const row = insMake.get(m.name, m.norm, m.source, m.types.join(",")) as { id: number };
      makes++;
      for (const a of m.aliases) insAlias.run(row.id, a);
      for (const md of m.models) {
        insModel.run(row.id, md.name, md.norm, md.type);
        models++;
      }
    }
    db.prepare(
      "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(FINGERPRINT_KEY, fp);
  });
  tx();
  return { seeded: true, makes, models };
}
