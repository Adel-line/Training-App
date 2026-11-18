-- Baseline so the migration runner has something to record. The real schema
-- (phases, plan, workouts, ...) arrives in milestone 2.
CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO app_meta (key, value) VALUES ('schema_started', datetime('now'));
