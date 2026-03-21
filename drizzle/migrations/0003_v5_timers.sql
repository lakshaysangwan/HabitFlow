-- v5: Recreate active_timers with pause support + add is_finalized to completions

-- Step 1: create new table with v5 schema
CREATE TABLE active_timers_v5 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  started_at TEXT,                                          -- NULL = paused
  accumulated_seconds INTEGER NOT NULL DEFAULT 0,          -- time from completed pause cycles
  target_override_seconds INTEGER,                         -- per-day countdown target increase
  logical_date TEXT NOT NULL,                              -- YYYY-MM-DD in user TZ at creation
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_active_timers_v5_user ON active_timers_v5(user_id);
CREATE INDEX IF NOT EXISTS idx_active_timers_v5_task ON active_timers_v5(task_id);

-- Step 2: migrate existing running timers (backfill logical_date as today UTC)
INSERT INTO active_timers_v5 (id, user_id, task_id, started_at, accumulated_seconds, target_override_seconds, logical_date, created_at)
  SELECT id, user_id, task_id, started_at, 0, NULL, date('now'), datetime('now')
  FROM active_timers;

-- Step 3: swap tables
DROP TABLE active_timers;
ALTER TABLE active_timers_v5 RENAME TO active_timers;

-- Step 4: rename indexes to canonical names
CREATE INDEX IF NOT EXISTS idx_active_timers_user ON active_timers(user_id);
CREATE INDEX IF NOT EXISTS idx_active_timers_task ON active_timers(task_id);

-- Step 5: add is_finalized to completions
ALTER TABLE completions ADD COLUMN is_finalized INTEGER NOT NULL DEFAULT 0;
