import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// ─── Users ───────────────────────────────────────────────────────────────────
export const users = sqliteTable('users', {
  id: text('id').primaryKey().default(sql`(lower(hex(randomblob(16))))`),
  username: text('username').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  display_name: text('display_name').notNull(),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  is_god: integer('is_god').notNull().default(0),
  theme: text('theme').notNull().default('system'), // light | dark | system
  token_version: integer('token_version').notNull().default(0),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

// ─── Invite Codes ─────────────────────────────────────────────────────────────
export const invite_codes = sqliteTable('invite_codes', {
  id: text('id').primaryKey().default(sql`(lower(hex(randomblob(16))))`),
  code: text('code').notNull().unique(),
  max_uses: integer('max_uses').notNull().default(10),
  current_uses: integer('current_uses').notNull().default(0),
  created_by: text('created_by').references(() => users.id),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// ─── Tasks ────────────────────────────────────────────────────────────────────
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey().default(sql`(lower(hex(randomblob(16))))`),
    user_id: text('user_id').notNull().references(() => users.id),
    name: text('name').notNull(),
    color: text('color').notNull(),
    frequency_type: text('frequency_type').notNull().default('daily'), // daily | weekly
    frequency_days: text('frequency_days'), // JSON array e.g. "[1,3,5]"
    data_type: text('data_type').notNull().default('none'), // none | text | number | both
    data_label: text('data_label'),
    status: text('status').notNull().default('active'), // active | paused | archived
    sort_order: integer('sort_order').notNull().default(0),
    start_date: text('start_date').notNull().default(sql`(date('now'))`),
    paused_at: text('paused_at'),
    tracking_mode: text('tracking_mode').notNull().default('binary'), // binary | stopwatch | countdown
    timer_target_seconds: integer('timer_target_seconds'),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
    updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_status_idx: index('idx_tasks_user_status').on(table.user_id, table.status),
  })
)

// ─── Completions ──────────────────────────────────────────────────────────────
export const completions = sqliteTable(
  'completions',
  {
    id: text('id').primaryKey().default(sql`(lower(hex(randomblob(16))))`),
    task_id: text('task_id').notNull().references(() => tasks.id),
    user_id: text('user_id').notNull().references(() => users.id),
    completed_date: text('completed_date').notNull(), // YYYY-MM-DD in user's timezone
    completed_at: text('completed_at').notNull().default(sql`(datetime('now'))`),
    data_text: text('data_text'),
    data_number: real('data_number'),
    duration_seconds: integer('duration_seconds'),
  },
  (table) => ({
    unique_task_date: uniqueIndex('uq_completions_task_date').on(table.task_id, table.completed_date),
    user_date_idx: index('idx_completions_user_date').on(table.user_id, table.completed_date),
    task_date_idx: index('idx_completions_task_date').on(table.task_id, table.completed_date),
  })
)

// ─── Audit Log ────────────────────────────────────────────────────────────────
export const audit_log = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey().default(sql`(lower(hex(randomblob(16))))`),
    event_type: text('event_type').notNull(), // login_success|login_fail|register|password_change|logout|god_access|token_revoke
    user_id: text('user_id'), // nullable (failed logins of non-existent users)
    ip_address: text('ip_address'),
    user_agent: text('user_agent'),
    metadata: text('metadata'), // JSON
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_idx: index('idx_audit_user').on(table.user_id, table.created_at),
  })
)

// ─── Active Timers ────────────────────────────────────────────────────────────
export const active_timers = sqliteTable(
  'active_timers',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').notNull().references(() => users.id),
    task_id: text('task_id').notNull().references(() => tasks.id),
    started_at: text('started_at').notNull(),
  },
  (table) => ({
    user_task_unique: uniqueIndex('uq_active_timers_user_task').on(table.user_id, table.task_id),
    user_idx: index('idx_active_timers_user').on(table.user_id),
    task_idx: index('idx_active_timers_task').on(table.task_id),
  })
)

// ─── Rate Limits ──────────────────────────────────────────────────────────────
export const rate_limits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(), // e.g. "auth:1.2.3.4" or "password:user_id"
  count: integer('count').notNull().default(1),
  window_start: integer('window_start').notNull(), // Unix timestamp (seconds)
})

// ─── Types ────────────────────────────────────────────────────────────────────
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
export type Completion = typeof completions.$inferSelect
export type NewCompletion = typeof completions.$inferInsert
export type InviteCode = typeof invite_codes.$inferSelect
export type AuditLog = typeof audit_log.$inferSelect
export type ActiveTimer = typeof active_timers.$inferSelect
export type NewActiveTimer = typeof active_timers.$inferInsert
