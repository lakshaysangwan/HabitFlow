/**
 * Completions API routes
 * GET    /api/completions?date=YYYY-MM-DD
 * POST   /api/completions
 * DELETE /api/completions/:id
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, inArray } from 'drizzle-orm'
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

const CreateCompletionSchema = z.object({
  task_id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  data_text: z.string().max(500).optional(),
  data_number: z.number().finite().min(-999999).max(999999).optional(),
})

function stripHTML(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/[\x00-\x1F]/g, '').trim()
}

// ─── GET /completions ─────────────────────────────────────────────────────────

app.get('/', async (c) => {
  const userId = await getUserId(c, c.env)
  if (!userId) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const date = c.req.query('date')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return err('VALIDATION_ERROR', 'date parameter required (YYYY-MM-DD)')
  }

  const db = getDB(c.env.DB)

  const completions = await db
    .select()
    .from(schema.completions)
    .where(and(eq(schema.completions.user_id, userId), eq(schema.completions.completed_date, date)))
    .all()

  // Fetch only the tasks referenced by these completions
  const taskIds = [...new Set(completions.map(c => c.task_id))]
  const tasks = taskIds.length > 0
    ? await db.select().from(schema.tasks)
        .where(and(eq(schema.tasks.user_id, userId), inArray(schema.tasks.id, taskIds)))
        .all()
    : []

  const taskMap = new Map(tasks.map(t => [t.id, { ...t, frequency_days: t.frequency_days ? JSON.parse(t.frequency_days) : null }]))

  const enriched = completions.map(c => ({
    ...c,
    task: taskMap.get(c.task_id) ?? null,
  }))

  return ok({ completions: enriched })
})

// ─── POST /completions ────────────────────────────────────────────────────────

app.post('/', async (c) => {
  const userId = await getUserId(c, c.env)
  if (!userId) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const body = await c.req.json().catch(() => null)
  const parsed = CreateCompletionSchema.safeParse(body)
  if (!parsed.success) return err('VALIDATION_ERROR', 'Invalid input')

  const { task_id, date, data_text, data_number } = parsed.data
  const db = getDB(c.env.DB)

  // Date not in future
  const today = new Date().toLocaleDateString('en-CA')
  if (date > today) return err('FUTURE_DATE', 'Cannot complete tasks in the future', 400)

  // IDOR: verify task belongs to user and is active
  const task = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, task_id), eq(schema.tasks.user_id, userId)))
    .get()

  if (!task) return err('NOT_FOUND', 'Task not found', 404)
  if (task.status === 'archived') return err('TASK_ARCHIVED', 'Cannot complete archived task', 400)
  if (date < task.start_date) return err('BEFORE_START', `This habit wasn't active on ${date}`, 400)

  // Validate day-of-week for weekly tasks
  if (task.frequency_type === 'weekly' && task.frequency_days) {
    const days: number[] = JSON.parse(task.frequency_days)
    const d = new Date(date + 'T12:00:00')
    const dow = d.getDay() === 0 ? 7 : d.getDay() // 1=Mon..7=Sun
    if (!days.includes(dow)) {
      return err('WRONG_DAY', `This habit is not scheduled for ${date}`, 400)
    }
  }

  const completionId = crypto.randomUUID().replace(/-/g, '')
  try {
    await db.insert(schema.completions).values({
      id: completionId,
      task_id,
      user_id: userId,
      completed_date: date,
      data_text: data_text ? stripHTML(data_text) : null,
      data_number: data_number ?? null,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ''
    if (msg.includes('UNIQUE') || msg.includes('unique')) {
      return err('ALREADY_COMPLETED', 'Task already completed for this date', 409)
    }
    throw e
  }

  const completion = {
    id: completionId,
    task_id,
    user_id: userId,
    completed_date: date,
    completed_at: new Date().toISOString(),
    data_text: data_text ? stripHTML(data_text) : null,
    data_number: data_number ?? null,
  }

  return ok({ completion }, 201)
})

// ─── DELETE /completions/:id ───────────────────────────────────────────────────

app.delete('/:id', async (c) => {
  const userId = await getUserId(c, c.env)
  if (!userId) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const completionId = c.req.param('id')
  const db = getDB(c.env.DB)

  // IDOR: verify completion belongs to user
  const existing = await db
    .select()
    .from(schema.completions)
    .where(and(eq(schema.completions.id, completionId), eq(schema.completions.user_id, userId)))
    .get()

  if (!existing) return err('NOT_FOUND', 'Completion not found', 404)

  await db
    .delete(schema.completions)
    .where(and(eq(schema.completions.id, completionId), eq(schema.completions.user_id, userId)))

  return ok(null)
})
