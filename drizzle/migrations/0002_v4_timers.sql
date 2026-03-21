-- v4.0: Timer tracking support
-- Tasks: add tracking mode columns
ALTER TABLE tasks ADD COLUMN tracking_mode TEXT NOT NULL DEFAULT 'binary';
ALTER TABLE tasks ADD COLUMN timer_target_seconds INTEGER;

-- Completions: add duration column
ALTER TABLE completions ADD COLUMN duration_seconds INTEGER;

-- New table: active_timers (server-persisted timer state)
CREATE TABLE IF NOT EXISTS active_timers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  started_at TEXT NOT NULL,
  UNIQUE(user_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_active_timers_user ON active_timers(user_id);
CREATE INDEX IF NOT EXISTS idx_active_timers_task ON active_timers(task_id);
