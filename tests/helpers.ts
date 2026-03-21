/**
 * Shared test helpers for HabitFlow tests.
 * Import `env` from `cloudflare:test` in each test file, then pass it here.
 */

import { signJWT } from '../functions/lib/jwt'
import { hashPassword } from '../functions/lib/crypto'
import { createApp } from '../functions/api/app'
import type { Env } from '../functions/lib/env'

// ─── Migration SQL (inlined to avoid fs access in Workers runtime) ─────────────

export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  is_god INTEGER NOT NULL DEFAULT 0,
  theme TEXT NOT NULL DEFAULT 'system',
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS invite_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  max_uses INTEGER NOT NULL DEFAULT 10,
  current_uses INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  frequency_type TEXT NOT NULL DEFAULT 'daily',
  frequency_days TEXT,
  data_type TEXT NOT NULL DEFAULT 'none',
  data_label TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  sort_order INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL DEFAULT (date('now')),
  paused_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS completions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  completed_date TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT (datetime('now')),
  data_text TEXT,
  data_number REAL,
  UNIQUE(task_id, completed_date)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL
);
ALTER TABLE tasks ADD COLUMN tracking_mode TEXT NOT NULL DEFAULT 'binary';
ALTER TABLE tasks ADD COLUMN timer_target_seconds INTEGER;
ALTER TABLE completions ADD COLUMN duration_seconds INTEGER;
ALTER TABLE completions ADD COLUMN is_finalized INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS active_timers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  started_at TEXT,
  accumulated_seconds INTEGER NOT NULL DEFAULT 0,
  target_override_seconds INTEGER,
  logical_date TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, task_id)
);
CREATE INDEX IF NOT EXISTS idx_active_timers_user ON active_timers(user_id);
CREATE INDEX IF NOT EXISTS idx_active_timers_task ON active_timers(task_id);
`

export async function applyMigrations(db: D1Database): Promise<void> {
  const statements = MIGRATION_SQL
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0)
  for (const stmt of statements) {
    await db.prepare(stmt).run()
  }
}

// ─── Seed helpers ──────────────────────────────────────────────────────────────

let _seq = 0
function uid(): string {
  return `test${Date.now()}${++_seq}`
}

export interface TestUser {
  id: string
  username: string
  password: string
  token: string
}

export async function createUser(
  db: D1Database,
  env: Env,
  opts: { username?: string; password?: string; isGod?: boolean } = {}
): Promise<TestUser> {
  const username = opts.username ?? `user_${uid()}`
  const password = opts.password ?? 'password123'
  const id = `u${uid()}`
  const hash = await hashPassword(password)

  await db
    .prepare(
      `INSERT INTO users (id, username, password_hash, display_name, is_god)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, username, hash, username, opts.isGod ? 1 : 0)
    .run()

  const token = await signJWT(
    { sub: id, username, is_god: opts.isGod ? 1 : 0, token_version: 0 },
    env
  )
  return { id, username, password, token }
}

export async function createTask(
  db: D1Database,
  userId: string,
  opts: {
    name?: string
    status?: 'active' | 'paused' | 'archived'
    frequency_type?: 'daily' | 'weekly'
    frequency_days?: number[]
    start_date?: string
    sort_order?: number
    tracking_mode?: 'binary' | 'stopwatch' | 'countdown'
    timer_target_seconds?: number | null
  } = {}
): Promise<{ id: string; name: string }> {
  const id = `t${uid()}`
  const name = opts.name ?? `Task ${uid()}`
  const today = new Date().toLocaleDateString('en-CA')

  await db
    .prepare(
      `INSERT INTO tasks (id, user_id, name, color, frequency_type, frequency_days, status, sort_order, start_date, tracking_mode, timer_target_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      userId,
      name,
      '#3B82F6',
      opts.frequency_type ?? 'daily',
      opts.frequency_days ? JSON.stringify(opts.frequency_days) : null,
      opts.status ?? 'active',
      opts.sort_order ?? 0,
      opts.start_date ?? today,
      opts.tracking_mode ?? 'binary',
      opts.timer_target_seconds ?? null
    )
    .run()

  return { id, name }
}

export async function createCompletion(
  db: D1Database,
  taskId: string,
  userId: string,
  date: string,
  opts: { data_text?: string; data_number?: number } = {}
): Promise<{ id: string }> {
  const id = `c${uid()}`
  await db
    .prepare(
      `INSERT INTO completions (id, task_id, user_id, completed_date, data_text, data_number) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, taskId, userId, date, opts.data_text ?? null, opts.data_number ?? null)
    .run()
  return { id }
}

export async function createInviteCode(
  db: D1Database,
  code?: string,
  maxUses = 10
): Promise<string> {
  const c = code ?? `INVITE-${uid()}`
  const id = `ic${uid()}`
  await db
    .prepare(
      `INSERT INTO invite_codes (id, code, max_uses, current_uses) VALUES (?, ?, ?, 0)`
    )
    .bind(id, c, maxUses)
    .run()
  return c
}

// ─── Request helper ────────────────────────────────────────────────────────────

const _app = createApp()

export async function req(
  method: string,
  path: string,
  env: Env,
  opts: { body?: unknown; token?: string } = {}
): Promise<{ status: number; body: Record<string, unknown>; cookie: string | null }> {
  const url = `http://localhost${path}`
  const headers: Record<string, string> = {}

  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (opts.token) {
    headers['Cookie'] = `token=${opts.token}`
  }

  // Unique IP per request to avoid rate limit interference across tests
  headers['CF-Connecting-IP'] = `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`

  const request = new Request(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })

  const res = await _app.fetch(request, env)
  const body = await res.json() as Record<string, unknown>

  // Extract token value from Set-Cookie header (e.g. "token=eyJ...; HttpOnly; ...")
  const setCookie = res.headers.get('Set-Cookie')
  let cookie: string | null = null
  if (setCookie) {
    const match = setCookie.match(/^token=([^;]+)/)
    if (match) cookie = match[1]
  }

  return { status: res.status, body, cookie }
}
