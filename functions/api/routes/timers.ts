/**
 * Timer API routes
 * POST /api/timers/start   — start a timer for a task
 * POST /api/timers/stop    — stop a timer, record duration
 * GET  /api/timers/active  — list all active timers for the current user
 * POST /api/timers/discard — discard a timer without recording completion
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { getDB, schema } from '../../lib/db'
import { ok, err } from '../../lib/response'
import { verifyJWT } from '../../lib/jwt'
import type { Env } from '../../lib/env'

export const app = new Hono<{ Bindings: Env }>()

async function getUserId(c: { req: { header: (k: string) => string | undefined } }, env: Env): Promise<string | null> {
  const cookie = c.req.header('Cookie') ?? ''
  const m = cookie.match(/(?:^|;\s*)token=([^;]+)/)
  if (!m) return null
  const payload = await verifyJWT(m[1], env)
  return payload?.sub ?? null
}

const TaskIdSchema = z.object({
  task_id: z.string().min(1),
})

// ─── POST /timers/start ───────────────────────────────────────────────────────

app.post('/start', async (c) => {
  const userId = await getUserId(c, c.env)
  if (!userId) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const body = await c.req.json().catch(() => null)
  const parsed = TaskIdSchema.safeParse(body)
  if (!parsed.success) return err('VALIDATION_ERROR', 'task_id required')

  const { task_id } = parsed.data
  const db = getDB(c.env.DB)

  // IDOR: verify task belongs to user and is valid for timer
  const task = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, task_id), eq(schema.tasks.user_id, userId)))
    .get()

  if (!task) return err('NOT_FOUND', 'Task not found', 404)
  if (task.status !== 'active') return err('TASK_NOT_ACTIVE', 'Task must be active to start timer', 400)
  if (task.tracking_mode === 'binary') return err('BINARY_TASK', 'Binary tasks cannot use timers', 400)

  // Check for existing active timer
  const existing = await db
    .select()
    .from(schema.active_timers)
    .where(and(eq(schema.active_timers.user_id, userId), eq(schema.active_timers.task_id, task_id)))
    .get()

  if (existing) return err('TIMER_ALREADY_RUNNING', 'Timer already running for this task', 409)

  const timerId = crypto.randomUUID().replace(/-/g, '')
  const startedAt = new Date().toISOString()

  await db.insert(schema.active_timers).values({
    id: timerId,
    user_id: userId,
    task_id,
    started_at: startedAt,
  })

  return ok({
    timer: {
      id: timerId,
      task_id,
      started_at: startedAt,
    },
  }, 201)
})

// ─── POST /timers/stop ────────────────────────────────────────────────────────

app.post('/stop', async (c) => {
  const userId = await getUserId(c, c.env)
  if (!userId) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const body = await c.req.json().catch(() => null)
  const parsed = TaskIdSchema.safeParse(body)
  if (!parsed.success) return err('VALIDATION_ERROR', 'task_id required')

  const { task_id } = parsed.data
  const db = getDB(c.env.DB)

  // Fetch active timer — IDOR protected
  const timer = await db
    .select()
    .from(schema.active_timers)
    .where(and(eq(schema.active_timers.user_id, userId), eq(schema.active_timers.task_id, task_id)))
    .get()

  if (!timer) return err('NOT_FOUND', 'No active timer for this task', 404)

  const task = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, task_id), eq(schema.tasks.user_id, userId)))
    .get()

  if (!task) return err('NOT_FOUND', 'Task not found', 404)

  const now = Date.now()
  const startedAtMs = new Date(timer.started_at).getTime()
  const elapsedSeconds = Math.floor((now - startedAtMs) / 1000)
  const today = new Date().toLocaleDateString('en-CA')
  const completionId = crypto.randomUUID().replace(/-/g, '')

  // Check for existing completion today (accumulate duration)
  const existing = await db
    .select()
    .from(schema.completions)
    .where(and(
      eq(schema.completions.task_id, task_id),
      eq(schema.completions.user_id, userId),
      eq(schema.completions.completed_date, today)
    ))
    .get()

  let finalDuration: number
  let returnCompletionId: string

  if (existing) {
    const newDuration = (existing.duration_seconds ?? 0) + elapsedSeconds
    await db
      .update(schema.completions)
      .set({ duration_seconds: newDuration })
      .where(eq(schema.completions.id, existing.id))
    finalDuration = newDuration
    returnCompletionId = existing.id
  } else {
    await db.insert(schema.completions).values({
      id: completionId,
      task_id,
      user_id: userId,
      completed_date: today,
      duration_seconds: elapsedSeconds,
    })
    finalDuration = elapsedSeconds
    returnCompletionId = completionId
  }

  // Delete active timer
  await db
    .delete(schema.active_timers)
    .where(and(eq(schema.active_timers.user_id, userId), eq(schema.active_timers.task_id, task_id)))

  return ok({
    completion: {
      id: returnCompletionId,
      duration_seconds: finalDuration,
      completed_date: today,
    },
    needs_data_input: task.data_type !== 'none',
  })
})

// ─── GET /timers/active ───────────────────────────────────────────────────────

app.get('/active', async (c) => {
  const userId = await getUserId(c, c.env)
  if (!userId) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const db = getDB(c.env.DB)

  const timers = await db
    .select({
      id: schema.active_timers.id,
      task_id: schema.active_timers.task_id,
      started_at: schema.active_timers.started_at,
      task_name: schema.tasks.name,
      task_color: schema.tasks.color,
      tracking_mode: schema.tasks.tracking_mode,
      timer_target_seconds: schema.tasks.timer_target_seconds,
    })
    .from(schema.active_timers)
    .innerJoin(schema.tasks, eq(schema.active_timers.task_id, schema.tasks.id))
    .where(eq(schema.active_timers.user_id, userId))
    .all()

  return ok({ timers })
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

  // IDOR: only delete if it belongs to this user
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
