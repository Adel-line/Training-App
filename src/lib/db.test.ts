import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { migrate } from "./db";

function dirWith(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "mig-"));
  for (const [n, sql] of Object.entries(files)) writeFileSync(path.join(dir, n), sql);
  return dir;
}

describe("migrate", () => {
  it("applies in order, once, and is safe to rerun", () => {
    const db = new DatabaseSync(":memory:");
    const dir = dirWith({ "0002_b.sql": "ALTER TABLE t ADD COLUMN y INT;", "0001_a.sql": "CREATE TABLE t (x INT);" });
    expect(migrate(db, dir)).toEqual(["0001_a.sql", "0002_b.sql"]);
    expect(migrate(db, dir)).toEqual([]);
  });
  it("rolls back a failing migration and reports it", () => {
    const db = new DatabaseSync(":memory:");
    const dir = dirWith({ "0001_bad.sql": "CREATE TABLE ok (x INT); SELECT nope FROM missing;" });
    expect(() => migrate(db, dir)).toThrow(/0001_bad.sql/);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='ok'").all()).toEqual([]);
  });
});
