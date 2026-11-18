import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Server-only. The whole app's data is this one SQLite file (see README for backups). */
export function dbPath(): string {
  return process.env.DB_PATH || path.join(process.cwd(), "data", "training.db");
}

/** Applies any `migrations/*.sql` files not yet recorded, in filename order, each in a transaction. */
export function migrate(db: DatabaseSync, dir = path.join(process.cwd(), "migrations")): string[] {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
  const done = new Set(
    (db.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map((r) => r.name),
  );
  const applied: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    db.exec("BEGIN");
    try {
      db.exec(readFileSync(path.join(dir, file), "utf-8"));
      db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
      db.exec("COMMIT");
      applied.push(file);
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return applied;
}

/** Runs seed/seed.sql (idempotent, INSERT OR IGNORE only). */
export function runSeed(db: DatabaseSync, file = path.join(process.cwd(), "seed", "seed.sql")): void {
  db.exec("BEGIN");
  try {
    db.exec(readFileSync(file, "utf-8"));
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw new Error(`Seed failed: ${(err as Error).message}`);
  }
}

/** Seeds a brand-new database once; later deletions of default rows are respected. */
export function seedOnce(db: DatabaseSync): void {
  const done = db.prepare("SELECT 1 FROM app_meta WHERE key = 'seeded'").get();
  if (done) return;
  runSeed(db);
  db.prepare("INSERT INTO app_meta (key, value) VALUES ('seeded', datetime('now'))").run();
}

let instance: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (!instance) {
    const file = dbPath();
    mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    migrate(db);
    seedOnce(db);
    instance = db;
  }
  return instance;
}
