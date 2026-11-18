-- Strava: connection (single athlete), OAuth state, and deleted-activity tombstones.
-- strava_tokens was an unused stub from the initial schema; it is replaced with the real shape.
DROP TABLE strava_tokens;
CREATE TABLE strava_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),         -- one connection
  athlete_id INTEGER NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,                   -- epoch seconds
  scope TEXT NOT NULL DEFAULT '',
  connected_at TEXT NOT NULL,
  refresh_lease_until INTEGER NOT NULL DEFAULT 0, -- epoch seconds; guards against concurrent refreshes
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Single-use, expiring OAuth state (only a hash is stored).
CREATE TABLE strava_oauth_states (
  state_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

-- A delete event leaves a tombstone so an older create/update event can't bring the activity back.
CREATE TABLE strava_deleted (
  strava_activity_id INTEGER PRIMARY KEY,
  event_time INTEGER NOT NULL
);

CREATE INDEX strava_jobs_due ON strava_jobs(status, run_after);
