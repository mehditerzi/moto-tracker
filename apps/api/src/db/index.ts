import Database, { type Database as DB } from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { config } from "../config.js";

let _db: DB | null = null;

export function getDb(): DB {
  if (_db) return _db;
  const p = config.DATABASE_PATH;
  if (p !== ":memory:") {
    const dir = path.dirname(p);
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(p);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  _db = db;
  return db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function resetDbForTests(newPath = ":memory:"): DB {
  closeDb();
  // overwrite config path at runtime for tests
  (config as { DATABASE_PATH: string }).DATABASE_PATH = newPath;
  return getDb();
}
