// Re-runnable: `npm run seed`. Adds any missing default rows; never overwrites edits.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { dbPath, migrate, runSeed } from "../src/lib/db.ts";

const file = dbPath();
mkdirSync(path.dirname(file), { recursive: true });
const db = new DatabaseSync(file);
db.exec("PRAGMA foreign_keys = ON");
console.log("migrations applied:", migrate(db));
runSeed(db);
console.log("seed ok:", file);
