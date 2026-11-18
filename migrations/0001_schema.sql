-- Single-user schema. Dates are Copenhagen calendar dates (YYYY-MM-DD, validated);
-- timestamps are UTC ISO-8601 with a trailing Z. IDs are text so the phone can
-- generate stable UUIDs offline (milestone 3).

CREATE TABLE phases (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  start_date TEXT NOT NULL UNIQUE CHECK (date(start_date) IS start_date),
  end_date TEXT NOT NULL CHECK (date(end_date) IS end_date),
  focus TEXT NOT NULL DEFAULT '',
  calorie_mode TEXT NOT NULL CHECK (calorie_mode IN ('baseline','deficit','maintenance')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (start_date <= end_date)
);
-- An identical start_date is left to the UNIQUE constraint so INSERT OR IGNORE (the seed) can skip it.
CREATE TRIGGER phases_no_overlap_ins BEFORE INSERT ON phases
WHEN NOT EXISTS (SELECT 1 FROM phases WHERE start_date = NEW.start_date)
 AND EXISTS (SELECT 1 FROM phases WHERE start_date <= NEW.end_date AND end_date >= NEW.start_date)
BEGIN SELECT RAISE(ABORT, 'phase dates overlap an existing phase'); END;
CREATE TRIGGER phases_no_overlap_upd BEFORE UPDATE ON phases
WHEN EXISTS (SELECT 1 FROM phases WHERE id <> NEW.id AND start_date <= NEW.end_date AND end_date >= NEW.start_date)
BEGIN SELECT RAISE(ABORT, 'phase dates overlap an existing phase'); END;

CREATE TABLE plan_days (
  weekday INTEGER PRIMARY KEY CHECK (weekday BETWEEN 1 AND 7), -- ISO: 1 = Monday
  session_type TEXT NOT NULL CHECK (session_type IN ('strength_a','strength_b','easy_run','quality_run','bouldering','long_day','rest')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE plan_day_overrides (
  date TEXT PRIMARY KEY CHECK (date(date) IS date),
  session_type TEXT NOT NULL CHECK (session_type IN ('strength_a','strength_b','easy_run','quality_run','bouldering','long_day','rest')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE exercises (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  muscle_group TEXT NOT NULL DEFAULT '',
  measurement_type TEXT NOT NULL CHECK (measurement_type IN ('reps','seconds')),
  per_side INTEGER NOT NULL DEFAULT 0 CHECK (per_side IN (0,1)),
  default_sets INTEGER NOT NULL CHECK (default_sets > 0),
  default_min INTEGER NOT NULL CHECK (default_min > 0),
  default_max INTEGER NOT NULL,
  increment_kg REAL CHECK (increment_kg IS NULL OR increment_kg > 0),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (default_min <= default_max)
);

CREATE TABLE session_templates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_type TEXT NOT NULL CHECK (session_type IN ('strength_a','strength_b','easy_run','quality_run','bouldering','long_day','rest')),
  exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 1),
  sets INTEGER NOT NULL CHECK (sets > 0),
  target_min INTEGER NOT NULL CHECK (target_min > 0),
  target_max INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (session_type, position),
  CHECK (target_min <= target_max)
);

CREATE TABLE workouts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  date TEXT NOT NULL CHECK (date(date) IS date),
  session_type TEXT NOT NULL CHECK (session_type IN ('strength_a','strength_b','easy_run','quality_run','bouldering','long_day','rest')),
  notes TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX workouts_date ON workouts(date);

-- Snapshot of the session's exercises and targets taken when the workout starts.
-- Later edits to templates or exercises never touch these rows.
CREATE TABLE workout_exercises (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  replaces_exercise_id TEXT REFERENCES exercises(id) ON DELETE SET NULL, -- set when swapped for this workout
  name TEXT NOT NULL,
  measurement_type TEXT NOT NULL CHECK (measurement_type IN ('reps','seconds')),
  per_side INTEGER NOT NULL CHECK (per_side IN (0,1)),
  sets INTEGER NOT NULL CHECK (sets > 0),
  target_min INTEGER NOT NULL,
  target_max INTEGER NOT NULL,
  increment_kg REAL,
  UNIQUE (workout_id, position)
);

CREATE TABLE workout_sets (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  workout_exercise_id TEXT NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  set_number INTEGER NOT NULL CHECK (set_number >= 1),
  side TEXT CHECK (side IN ('left','right')),
  reps INTEGER CHECK (reps IS NULL OR reps >= 0),
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  weight_kg REAL CHECK (weight_kg IS NULL OR weight_kg >= 0),
  rir INTEGER CHECK (rir IS NULL OR rir BETWEEN 0 AND 4),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((reps IS NOT NULL) <> (duration_seconds IS NOT NULL))
);
CREATE UNIQUE INDEX workout_sets_logical ON workout_sets(workout_exercise_id, set_number, COALESCE(side, ''));
CREATE INDEX workout_sets_exercise_workout ON workout_sets(exercise_id, workout_id);

-- Valid combinations per measurement type, and consistent parent references.
CREATE TRIGGER workout_sets_validate_ins BEFORE INSERT ON workout_sets
WHEN NOT EXISTS (
  SELECT 1 FROM workout_exercises we
  WHERE we.id = NEW.workout_exercise_id AND we.workout_id = NEW.workout_id AND we.exercise_id = NEW.exercise_id
    AND ((we.measurement_type = 'reps' AND NEW.reps IS NOT NULL AND NEW.duration_seconds IS NULL)
      OR (we.measurement_type = 'seconds' AND NEW.duration_seconds IS NOT NULL AND NEW.reps IS NULL AND NEW.weight_kg IS NULL))
    AND ((we.per_side = 1 AND NEW.side IS NOT NULL) OR (we.per_side = 0 AND NEW.side IS NULL))
)
BEGIN SELECT RAISE(ABORT, 'set does not match its workout exercise (type, side or parent)'); END;
CREATE TRIGGER workout_sets_validate_upd BEFORE UPDATE ON workout_sets
WHEN NOT EXISTS (
  SELECT 1 FROM workout_exercises we
  WHERE we.id = NEW.workout_exercise_id AND we.workout_id = NEW.workout_id AND we.exercise_id = NEW.exercise_id
    AND ((we.measurement_type = 'reps' AND NEW.reps IS NOT NULL AND NEW.duration_seconds IS NULL)
      OR (we.measurement_type = 'seconds' AND NEW.duration_seconds IS NOT NULL AND NEW.reps IS NULL AND NEW.weight_kg IS NULL))
    AND ((we.per_side = 1 AND NEW.side IS NOT NULL) OR (we.per_side = 0 AND NEW.side IS NULL))
)
BEGIN SELECT RAISE(ABORT, 'set does not match its workout exercise (type, side or parent)'); END;

CREATE TABLE strava_tokens ( -- one connection; server-only
  id INTEGER PRIMARY KEY CHECK (id = 1),
  athlete_id INTEGER NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE strava_activities (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  strava_activity_id INTEGER NOT NULL UNIQUE,
  start_date TEXT NOT NULL, -- UTC instant; local date is derived in Europe/Copenhagen
  name TEXT NOT NULL DEFAULT '',
  distance_m REAL NOT NULL DEFAULT 0,
  moving_time_s INTEGER NOT NULL DEFAULT 0,
  elevation_gain_m REAL,
  avg_hr REAL,
  avg_speed_mps REAL,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('Run','TrailRun','Hike','Snowboard')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX strava_activities_start_date ON strava_activities(start_date);

CREATE TABLE strava_jobs ( -- durable queue for backfill and webhook events; server-only
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  kind TEXT NOT NULL CHECK (kind IN ('backfill','webhook_event')),
  dedupe_key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE weigh_ins (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  date TEXT NOT NULL UNIQUE CHECK (date(date) IS date),
  weight_kg REAL NOT NULL CHECK (weight_kg > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE food_days (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  date TEXT NOT NULL UNIQUE CHECK (date(date) IS date),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE meals (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  date TEXT NOT NULL CHECK (date(date) IS date),
  time TEXT CHECK (time IS NULL OR time GLOB '[0-2][0-9]:[0-5][0-9]'),
  label TEXT NOT NULL,
  kcal INTEGER NOT NULL CHECK (kcal >= 0),
  protein_g REAL NOT NULL CHECK (protein_g >= 0),
  note TEXT NOT NULL DEFAULT '',
  photo_path TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX meals_date ON meals(date);

CREATE TABLE targets (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  protein_g_min INTEGER NOT NULL CHECK (protein_g_min >= 0),
  protein_g_max INTEGER NOT NULL,
  kcal_target INTEGER CHECK (kcal_target IS NULL OR kcal_target > 0),
  effective_from TEXT NOT NULL UNIQUE CHECK (date(effective_from) IS effective_from),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (protein_g_min <= protein_g_max)
);

CREATE TABLE progress_photos (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  taken_on TEXT NOT NULL CHECK (date(taken_on) IS taken_on),
  view TEXT NOT NULL CHECK (view IN ('front','side','back')),
  storage_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
