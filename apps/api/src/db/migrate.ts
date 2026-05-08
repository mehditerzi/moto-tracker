import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, "migrations");

export function runMigrations(): { applied: string[]; skipped: string[] } {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const exists = db
      .prepare("SELECT 1 FROM _migrations WHERE name = ?")
      .get(file);
    if (exists) {
      skipped.push(file);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations(name) VALUES (?)").run(file);
    });
    tx();
    applied.push(file);
  }
  return { applied, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { applied, skipped } = runMigrations();
  console.log(`[migrate] applied: ${applied.length}, skipped: ${skipped.length}`);
  if (applied.length) console.log(applied.map((m) => "  + " + m).join("\n"));
}
