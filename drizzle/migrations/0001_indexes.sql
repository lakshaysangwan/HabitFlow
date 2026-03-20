-- Migration 0001: Additional performance indexes

-- Speeds up completions GET when resolving task details (user_id + task_id lookup)
CREATE INDEX IF NOT EXISTS idx_completions_user_task ON completions(user_id, task_id);

-- Speeds up admin LIKE search on display_name
CREATE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name);
