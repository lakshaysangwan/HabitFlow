/**
 * Timer API routes — v5
 *
 * POST   /api/timers/start   — start a new timer (idle → running)
 * POST   /api/timers/pause   — pause a running timer (running → paused)
 * POST   /api/timers/resume  — resume a paused timer (paused → running)
 * POST   /api/timers/done    — finalize the timer and create/update completion
 * POST   /api/timers/discard — delete timer without recording completion
 * GET    /api/timers/active  — list all timers for the current user
 * PATCH  /api/timers/target  — increase countdown target while paused
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, count } from 'drizzle-orm'
import { getDB, schema } from '../../lib/db'
import { ok, err } from '../../lib/response'
import { verifyJWT } from '../../lib/jwt'
import type { Env } from '../../lib/env'

export const app = new Hono<{ Bindings: Env }>()

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function getUserId(c: { req: { header: (k: string) => string | undefined } }, env: Env): Promise<string | null> {
  const cookie = c.req.header('Cookie') ?? ''
  const m = cookie.match(/(?:^|;\s*)token=([^;]+)/)
  if (!m) return null
  const payload = await verifyJWT(m[1], env)
  return payload?.sub ?? null
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** Returns today's date (YYYY-MM-DD) in the given IANA timezone */
function todayInTZ(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
  } catch {
    return new Date().toLocaleDateString('en-CA')
  }
}

/** Returns yesterday's date (YYYY-MM-DD) in the given IANA timezone */
function yesterdayInTZ(tz: string): string {
  try {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)
  } catch {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d.toLocaleDateString('en-CA')
  }
}

/** End-of-day UTC ms for a YYYY-MM-DD date in a given timezone */
function endOfDayMs(logicalDate: string, tz: string): number {
  // Build a date representing 23:59:59.999 at the end of logicalDate in tz
  // by finding the start of next day and subtracting 1ms
  try {
    const [y, m, d] = logicalDate.split('-').map(Number)
    // Start of next day in tz
    const nextDayStr = new Date(Date.UTC(y, m - 1, d + 1))
      .toLocaleDateString('en-CA', { timeZone: tz })
    // Parse that back as start-of-day
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
    })
    // Use a simple approach: find the UTC timestamp for midnight of nextDayStr in tz
    // We approximate by getting the UTC offset at that point
    const probe = new Date(`${nextDayStr}T00:00:00`)
    return probe.getTime() - 1
  } catch {
    // fallback: end of logical date UTC
    const [y, m, d] = logicalDate.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999)).getTime()
  }
}

// ─── Shared schema ────────────────────────────────────────────────────────────

const TaskIdSchema = z.object({ task_id: z.string().min(1) })

// ─── POST /timers/start ───────────────────────────────────────────────────────

app.post('/start', async (c) => {
  const userId = await getUserId(c, c.env)
  if (!userId) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const body = await c.req.json().catch(() => null)
  const parsed = TaskIdSchema.safeParse(body)
  if (!parsed.success) return err('VALIDATION_ERROR', 'task_id required')

  const { task_id } = parsed.data
  const db = getDB(c.env.DB)

  // IDOR: verify task belongs to user
  const task = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, task_id), eq(schema.tasks.user_id, userId)))
    .get()

  if (!task) return err('NOT_FOUND', 'Task not found', 404)
  if (task.status !== 'active') return err('TASK_NOT_ACTIVE', 'Task must be active to start timer', 400)
  if (task.tracking_mode === 'binary') return err('BINARY_TASK', 'Binary tasks cannot use timers', 400)

  // Fetch user for timezone
  const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get()
  const tz = user?.timezone ?? 'UTC'
  const today = todayInTZ(tz)

  // Check not already finalized today
  const finalized = await db
    .select()
    .from(schema.completions)
    .where(and(
      eq(schema.completions.task_id, task_id),
      eq(schema.completions.user_id, userId),
      eq(schema.completions.completed_date, today),
    ))
    .get()

  if (finalized?.is_finalized) return err('ALREADY_FINALIZED', 'Already completed for today', 409)

  // Check no existing timer
  const existing = await db
    .select()
    .from(schema.active_timers)
    .where(and(eq(schema.active_timers.user_id, userId), eq(schema.active_timers.task_id, task_id)))
    .get()

  if (existing) return err('TIMER_ALREADY_RUNNING', 'Timer already exists for this task', 409)

  // Max 3 concurrent timers
  const [{ value: timerCount }] = await db
    .select({ value: count() })
    .from(schema.active_timers)
    .where(eq(schema.active_timers.user_id, userId))

  if (timerCount >= 3) return err('TOO_MANY_TIMERS', 'Max 3 concurrent timers. Finish one first.', 409)

  const timerId = crypto.randomUUID().replace(/-/g, '')
  const startedAt = new Date().toISOString()

  await db.insert(schema.active_timers).values({
    id: timerId,
    user_id: userId,
    task_id,
    started_at: startedAt,
    accumulated_seconds: 0,
    logical_date: today,
  })

  return ok({ timer: { id: timerId, task_id, started_at: startedAt, accumulated_seconds: 0, logical_date: today } }, 201)
})

// ─── POST /timers/pause ───────────────────────────────────────────────────────

app.post('/pause', async (c) => {
  const userId = await getUserId(c, c.env)
  if (!userId) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const body = await c.req.json().catch(() => null)
  const parsed = TaskIdSchema.safeParse(body)
  if (!parsed.success) return err('VALIDATION_ERROR', 'task_id required')

  const { task_id } = parsed.data
  const db = getDB(c.env.DB)

  const timer = await db
    .select()
    .from(schema.active_timers)
    .where(and(eq(schema.active_timers.user_id, userId), eq(schema.active_timers.task_id, task_id)))
    .get()

  if (!timer) return err('NOT_FOUND', 'No active timer for this task', 404)
  if (!timer.started_at) return err('ALREADY_PAUSED', 'Timer is already paused', 400)

  // Orphan check
  const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get()
  const tz = user?.timezone ?? 'UTC'
  const today = todayInTZ(tz)

  if (timer.logical_date !== today) {
    // Auto-cap elapsed at end of logical_date
    const capMs = endOfDayMs(timer.logical_date, tz)
    const startMs = new Date(timer.started_at).getTime()
    const sessionSeconds = Math.max(0, Math.floor((Math.min(capMs, Date.now()) - startMs) / 1000))
    await db
      .update(schema.active_timers)
      .set({ started_at: null, accumulated_seconds: timer.accumulated_seconds + sessionSeconds })
      .where(eq(schema.active_timers.id, timer.id))
    return err('ORPHANED_TIMER', 'Timer is from a previous day and has been paused', 409)
  }

  const now = Date.now()
  const sessionSeconds = Math.floor((now - new Date(timer.started_at).getTime()) / 1000)
  const newAccumulated = timer.accumulated_seconds + sessionSeconds

  await db
    .update(schema.active_timers)
    .set({ started_at: null, accumulated_seconds: newAccumulated })
    .where(eq(schema.active_timers.id, timer.id))

  return ok({ timer: { task_id, accumulated_seconds: newAccumulated, logical_date: timer.logical_date } })
})

// ─── POST /timers/resume ──────────────────────────────────────────────────────

app.post('/resume', async (c) => {
  const userId = await getUserId(c, c.env)
  if (!userId) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const body = await c.req.json().catch(() => null)
  const parsed = TaskIdSchema.safeParse(body)
  if (!parsed.success) return err('VALIDATION_ERROR', 'task_id required')

  const { task_id } = parsed.data
  const db = getDB(c.env.DB)

  const timer = await db
    .select()
    .from(schema.active_timers)
    .where(and(eq(schema.active_timers.user_id, userId), eq(schema.active_timers.task_id, task_id)))
    .get()

  if (!timer) return err('NOT_FOUND', 'No timer found for this task', 404)
  if (timer.started_at) return err('ALREADY_RUNNING', 'Timer is already running', 400)

  // Orphan check
  const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get()
  const tz = user?.timezone ?? 'UTC'
  const today = todayInTZ(tz)

  if (timer.logical_date !== today) return err('ORPHANED_TIMER', 'Timer is from a previous day', 409)

  // Check not finalized
  const finalized = await db
    .select()
    .from(schema.completions)
    .where(and(
      eq(schema.completions.task_id, task_id),
      eq(schema.completions.user_id, userId),
      eq(schema.completions.completed_date, today),
    ))
    .get()

  if (finalized?.is_finalized) return err('ALREADY_FINALIZED', 'Already completed for today', 400)

  const startedAt = new Date().toISOString()
  await db
    .update(schema.active_timers)
    .set({ started_at: startedAt })
    .where(eq(schema.active_timers.id, timer.id))

  return ok({ timer: { task_id, started_at: startedAt, accumulated_seconds: timer.accumulated_seconds } })
})

// ─── POST /timers/done ────────────────────────────────────────────────────────

app.post('/done', async (c) => {
  const userId = await getUserId(c, c.env)
  if (!userId) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const body = await c.req.json().catch(() => null)
  const parsed = z.object({
    task_id: z.string().min(1),
    data_text: z.string().max(500).optional(),
    data_number: z.number().min(-999999).max(999999).optional(),
  }).safeParse(body)
  if (!parsed.success) return err('VALIDATION_ERROR', 'task_id required')

  const { task_id, data_text, data_number } = parsed.data
  const db = getDB(c.env.DB)

  const timer = await db
    .select()
    .from(schema.active_timers)
    .where(and(eq(schema.active_timers.user_id, userId), eq(schema.active_timers.task_id, task_id)))
    .get()

  if (!timer) return err('NOT_FOUND', 'No timer found for this task', 404)

  // Orphan check
  const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get()
  const tz = user?.timezone ?? 'UTC'
  const today = todayInTZ(tz)

  if (timer.logical_date !== today) return err('ORPHANED_TIMER', 'Timer is from a previous day — discard it', 409)

  // If running, auto-pause first to accumulate current session
  let totalSeconds = timer.accumulated_seconds
  if (timer.started_at) {
    const sessionSeconds = Math.floor((Date.now() - new Date(timer.started_at).getTime()) / 1000)
    totalSeconds += sessionSeconds
  }

  const completionId = crypto.randomUUID().replace(/-/g, '')

  // Upsert completion with is_finalized = 1
  const existing = await db
    .select()
    .from(schema.completions)
    .where(and(
      eq(schema.completions.task_id, task_id),
      eq(schema.completions.user_id, userId),
      eq(schema.completions.completed_date, today),
    ))
    .get()

  let returnId: string
  let finalDuration: number

  if (existing) {
    finalDuration = (existing.duration_seconds ?? 0) + totalSeconds
    await db
      .update(schema.completions)
      .set({
        duration_seconds: finalDuration,
        is_finalized: 1,
        ...(data_text !== undefined ? { data_text } : {}),
        ...(data_number !== undefined ? { data_number } : {}),
      })
      .where(eq(schema.completions.id, existing.id))
    returnId = existing.id
  } else {
    finalDuration = totalSeconds
    await db.insert(schema.completions).values({
      id: completionId,
      task_id,
      user_id: userId,
      completed_date: today,
      duration_seconds: finalDuration,
      is_finalized: 1,
      data_text: data_text ?? null,
      data_number: data_number ?? null,
    })
    returnId = completionId
  }

  // Delete active timer
  await db
    .delete(schema.active_timers)
    .where(and(eq(schema.active_timers.user_id, userId), eq(schema.active_timers.task_id, task_id)))

  const task = await db.select().from(schema.tasks).where(eq(schema.tasks.id, task_id)).get()

  return ok({
    completion: {
      id: returnId,
      duration_seconds: finalDuration,
      completed_date: today,
      is_finalized: 1,
    },
    needs_data_input: (task?.data_type ?? 'none') !== 'none',
  })
})

// ─── POST /timers/discard ─────────────────────────────────────────────────────

app.post('/discard', async (c) => {
  const userId = await getUserId(c, c.env)
  if (!userId) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const body = await c.req.json().catch(() => null)
  const parsed = TaskIdSchema.safeParse(body)
  if (!parsed.success) return err('VALIDATION_ERROR', 'task_id required')

  const { task_id } = parsed.data
  const db = getDB(c.env.DB)

  const existing = await db
    .select()
    .from(schema.active_timers)
    .where(and(eq(schema.active_timers.user_id, userId), eq(schema.active_timers.task_id, task_id)))
    .get()

  if (!existing) return err('NOT_FOUND', 'No active timer for this task', 404)

  await db
    .delete(schema.active_timers)
    .where(and(eq(schema.active_timers.user_id, userId), eq(schema.active_timers.task_id, task_id)))

  return ok({ ok: true })
})

// ─── GET /timers/active ───────────────────────────────────────────────────────

app.get('/active', async (c) => {
  const userId = await getUserId(c, c.env)
  if (!userId) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const db = getDB(c.env.DB)

  const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get()
  const tz = user?.timezone ?? 'UTC'
  const today = todayInTZ(tz)

  const timers = await db
    .select({
      id: schema.active_timers.id,
      task_id: schema.active_timers.task_id,
      started_at: schema.active_timers.started_at,
      accumulated_seconds: schema.active_timers.accumulated_seconds,
      target_override_seconds: schema.active_timers.target_override_seconds,
      logical_date: schema.active_timers.logical_date,
      task_name: schema.tasks.name,
      task_color: schema.tasks.color,
      tracking_mode: schema.tasks.tracking_mode,
      timer_target_seconds: schema.tasks.timer_target_seconds,
    })
    .from(schema.active_timers)
    .innerJoin(schema.tasks, eq(schema.active_timers.task_id, schema.tasks.id))
    .where(eq(schema.active_timers.user_id, userId))
    .all()

  // Mark orphaned timers (logical_date ≠ today) — auto-pause them if running
  const result = await Promise.all(timers.map(async (t) => {
    const isOrphaned = t.logical_date !== today
    if (isOrphaned && t.started_at) {
      // Auto-pause: cap elapsed at end of logical_date
      const capMs = endOfDayMs(t.logical_date, tz)
      const startMs = new Date(t.started_at).getTime()
      const sessionSeconds = Math.max(0, Math.floor((Math.min(capMs, Date.now()) - startMs) / 1000))
      const newAccumulated = t.accumulated_seconds + sessionSeconds
      await db
        .update(schema.active_timers)
        .set({ started_at: null, accumulated_seconds: newAccumulated })
        .where(eq(schema.active_timers.id, t.id))
      return { ...t, started_at: null, accumulated_seconds: newAccumulated, orphaned: true }
    }
    return { ...t, orphaned: isOrphaned }
  }))

  return ok({ timers: result })
})

// ─── PATCH /timers/target ─────────────────────────────────────────────────────

app.patch('/target', async (c) => {
  const userId = await getUserId(c, c.env)
  if (!userId) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const body = await c.req.json().catch(() => null)
  const parsed = z.object({
    task_id: z.string().min(1),
    target_seconds: z.number().int().min(10).max(86400),
  }).safeParse(body)
  if (!parsed.success) return err('VALIDATION_ERROR', 'task_id and target_seconds required')

  const { task_id, target_seconds } = parsed.data
  const db = getDB(c.env.DB)

  const timer = await db
    .select()
    .from(schema.active_timers)
    .where(and(eq(schema.active_timers.user_id, userId), eq(schema.active_timers.task_id, task_id)))
    .get()

  if (!timer) return err('NOT_FOUND', 'No timer found for this task', 404)
  if (timer.started_at) return err('TIMER_RUNNING', 'Pause the timer before adjusting target', 400)

  const task = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, task_id), eq(schema.tasks.user_id, userId)))
    .get()

  if (!task || task.tracking_mode !== 'countdown') return err('NOT_COUNTDOWN', 'Target only applies to countdown tasks', 400)

  const effectiveTarget = timer.target_override_seconds ?? task.timer_target_seconds ?? 0

  if (target_seconds <= effectiveTarget) return err('TARGET_TOO_LOW', 'New target must be greater than current target', 400)
  if (target_seconds < timer.accumulated_seconds) return err('TARGET_BELOW_ELAPSED', 'New target cannot be less than elapsed time', 400)

  // Check not finalized
  const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get()
  const tz = user?.timezone ?? 'UTC'
  const today = todayInTZ(tz)

  const finalized = await db
    .select()
    .from(schema.completions)
    .where(and(
      eq(schema.completions.task_id, task_id),
      eq(schema.completions.user_id, userId),
      eq(schema.completions.completed_date, today),
    ))
    .get()

  if (finalized?.is_finalized) return err('ALREADY_FINALIZED', 'Already completed for today', 400)

  await db
    .update(schema.active_timers)
    .set({ target_override_seconds: target_seconds })
    .where(eq(schema.active_timers.id, timer.id))

  return ok({ timer: { task_id, target_override_seconds: target_seconds } })
})
