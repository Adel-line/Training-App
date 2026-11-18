-- Editable default content. Every statement is INSERT OR IGNORE on a natural key,
-- so re-running never duplicates rows or overwrites anything you have edited.

INSERT OR IGNORE INTO plan_days (weekday, session_type, notes) VALUES
  (1, 'strength_a',  'Lower body and glutes, 50–60 min'),
  (2, 'easy_run',    '5–6 km at 6:50–7:15/km, talking pace'),
  (3, 'strength_b',  'Upper body, core and glutes, 50–60 min'),
  (4, 'quality_run', '6–7 km with hills or intervals'),
  (5, 'bouldering',  'Optional second easy session'),
  (6, 'long_day',    'Hike with pack, long easy run, or snowboard'),
  (7, 'rest',        'Rest');

INSERT OR IGNORE INTO phases (name, start_date, end_date, focus, calorie_mode) VALUES
  ('Phase 1', '2026-11-23', '2026-12-06', 'Technique and strength base, baseline tracking', 'baseline'),
  ('Phase 1', '2026-12-07', '2026-12-20', 'Technique and strength base', 'deficit'),
  ('Phase 2', '2026-12-21', '2027-01-31', 'Two heavier strength sessions, longer Saturdays, loaded uphill once a week', 'deficit'),
  ('Phase 3', '2027-02-01', '2027-02-28', 'Splitboard-specific long days, shorter strength sessions', 'maintenance');

INSERT OR IGNORE INTO targets (protein_g_min, protein_g_max, kcal_target, effective_from)
  VALUES (110, 130, NULL, '2026-11-23');

-- name, muscle_group, measurement_type, per_side, sets, min, max, increment_kg
-- Lower-body loaded lifts +2 kg, upper-body loaded lifts +1 kg; bodyweight/timed have none.
INSERT OR IGNORE INTO exercises (name, muscle_group, measurement_type, per_side, default_sets, default_min, default_max, increment_kg) VALUES
  ('Goblet box squat',                 'quads/glutes', 'reps',    0, 3,  8, 10, 2),
  ('Romanian deadlift (RDL)',          'hamstrings',   'reps',    0, 3,  8, 10, 2),
  ('Hip thrust',                       'glutes',       'reps',    0, 3, 10, 12, 2),
  ('Step-up',                          'quads/glutes', 'reps',    1, 3,  8,  8, 2),
  ('Calf raise',                       'calves',       'reps',    0, 2, 12, 12, NULL),
  ('Side plank',                       'core',         'seconds', 1, 2, 30, 30, NULL),
  ('Incline push-up',                  'chest',        'reps',    0, 3,  6, 10, NULL),
  ('Pull-up negatives / band-assisted pull-ups', 'back', 'reps',  0, 4,  3,  5, NULL),
  ('One-arm dumbbell row',             'back',         'reps',    1, 3, 10, 10, 1),
  ('Dumbbell overhead press',          'shoulders',    'reps',    0, 3,  8, 10, 1),
  ('Single-leg glute bridge',          'glutes',       'reps',    1, 3, 12, 12, NULL),
  ('Dead bug / Pallof press',          'core',         'reps',    1, 3, 10, 10, NULL);

-- session, exercise, position, sets, min, max (targets follow the exercise's measurement type)
INSERT OR IGNORE INTO session_templates (session_type, exercise_id, position, sets, target_min, target_max)
SELECT t.session_type, e.id, t.position, t.sets, t.tmin, t.tmax
FROM (
  SELECT 'strength_a' AS session_type, 'Goblet box squat' AS name, 1 AS position, 3 AS sets,  8 AS tmin, 10 AS tmax UNION ALL
  SELECT 'strength_a', 'Romanian deadlift (RDL)', 2, 3,  8, 10 UNION ALL
  SELECT 'strength_a', 'Hip thrust',              3, 3, 10, 12 UNION ALL
  SELECT 'strength_a', 'Step-up',                 4, 3,  8,  8 UNION ALL
  SELECT 'strength_a', 'Calf raise',              5, 2, 12, 12 UNION ALL
  SELECT 'strength_a', 'Side plank',              6, 2, 30, 30 UNION ALL
  SELECT 'strength_b', 'Incline push-up',         1, 3,  6, 10 UNION ALL
  SELECT 'strength_b', 'Pull-up negatives / band-assisted pull-ups', 2, 4, 3, 5 UNION ALL
  SELECT 'strength_b', 'One-arm dumbbell row',    3, 3, 10, 10 UNION ALL
  SELECT 'strength_b', 'Dumbbell overhead press', 4, 3,  8, 10 UNION ALL
  SELECT 'strength_b', 'Single-leg glute bridge', 5, 3, 12, 12 UNION ALL
  SELECT 'strength_b', 'Dead bug / Pallof press', 6, 3, 10, 10
) t JOIN exercises e ON e.name = t.name;
