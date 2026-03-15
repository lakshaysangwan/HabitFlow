/**
 * Tasks API routes
 * GET    /api/tasks
 * POST   /api/tasks
 * PATCH  /api/tasks/:id
 * DELETE /api/tasks/:id
 * PATCH  /api/tasks/:id/pause
 * PATCH  /api/tasks/:id/resume
 * PUT    /api/tasks/reorder
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, inArray } from 'drizzle-orm'
import { getDB, schema } from '../../lib/db'
import { pickTaskColor } from '../../lib/colors'
import { ok, err } from '../../lib/response'
import { verifyJWT } from '../../lib/jwt'
import type { Env } from '../../lib/env'

export const app = new Hono<{ Bindings: Env }>()

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function getAuthedUserId(c: { req: { header: (k: string) => string | undefined } }, env: Env): Promise<string | null> {
  const cookieHeader = (c.req.header('Cookie') ?? '')
  const tokenMatch = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/)
  const token = tokenMatch?.[1]
  if (!token) return null
  const payload = await verifyJWT(token, env)
  return payload?.sub ?? null
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const CreateTaskSchema = z.object({
  name: z.string().min(1).max(100),
  frequency_type: z.enum(['daily', 'weekly']).default('daily'),
  frequency_days: z.array(z.number().int().min(1).max(7)).optional(),
  data_type: z.enum(['none', 'text', 'number', 'both']).default('none'),
  data_label: z.string().max(50).optional(),
})

const UpdateTaskSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  frequency_type: z.enum(['daily', 'weekly']).optional(),
  frequency_days: z.array(z.number().int().min(1).max(7)).optional().nullable(),
  data_type: z.enum(['none', 'text', 'number', 'both']).optional(),
  data_label: z.string().max(50).optional().nullable(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
})

const ReorderSchema = z.object({
  task_ids: z.array(z.string()).min(1),
})

function stripHTML(s: string): string {
  return s
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\x00-\x1F]/g, '')
    .trim()
}

// ─── GET /tasks ───────────────────────────────────────────────────────────────

app.get('/', async (c) => {
  const userId = await getAuthedUserId(c, c.env)
  if (!userId) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const statusParam = c.req.query('status') ?? 'active'
  const db = getDB(c.env.DB)

  let tasks
  if (statusParam === 'all') {
    tasks = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.user_id, userId))
      .orderBy(schema.tasks.sort_order)
      .all()
  } else {
    const status = ['active', 'paused', 'archived'].includes(statusParam)
      ? (statusParam as 'active' | 'paused' | 'archived')
      : 'active'
    tasks = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.user_id, userId), eq(schema.tasks.status, status)))
      .orderBy(schema.tasks.sort_order)
      .all()
  }

  const parsed = tasks.map(t => ({
    ...t,
    frequency_days: t.frequency_days ? JSON.parse(t.frequency_days) : null,
  }))

  return ok({ tasks: parsed })
})

// ─── POST /tasks ──────────────────────────────────────────────────────────────

app.post('/', async (c) => {
  const userId = await getAuthedUserId(c, c.env)
  if (!userId) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const body = await c.req.json().catch(() => null)
  const parsed = CreateTaskSchema.safeParse(body)
  if (!parsed.success) return err('VALIDATION_ERROR', 'Invalid input')

  const { name, frequency_type, frequency_days, data_type, data_label } = parsed.data
  const db = getDB(c.env.DB)

  // Get existing colors for this user
  const existing = await db
    .select({ color: schema.tasks.color })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.user_id, userId), eq(schema.tasks.status, 'active')))
    .all()

  const paused = await db
    .select({ color: schema.tasks.color })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.user_id, userId), eq(schema.tasks.status, 'paused')))
    .all()

  const usedColors = [...existing, ...paused].map(t => t.color)
  const color = pickTaskColor(usedColors)

  // Get max sort_order
  const allTasks = await db
    .select({ sort_order: schema.tasks.sort_order })
    .from(schema.tasks)
    .where(eq(schema.tasks.user_id, userId))
    .all()
  const maxOrder = allTasks.length > 0 ? Math.max(...allTasks.map(t => t.sort_order)) : -1

  const taskId = crypto.randomUUID().replace(/-/g, '')
  await db.insert(schema.tasks).values({
    id: taskId,
    user_id: userId,
    name: stripHTML(name),
    color,
    frequency_type,
    frequency_days: frequency_days ? JSON.stringify(frequency_days) : null,
    data_type: data_type ?? 'none',
    data_label: data_label ? stripHTML(data_label) : null,
    status: 'active',
    sort_order: maxOrder + 1,
    start_date: new Date().toLocaleDateString('en-CA'),
  })

  const task = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get()
  if (!task) return err('SERVER_ERROR', 'Failed to create task', 500)

  return ok({
    task: { ...task, frequency_days: task.frequency_days ? JSON.parse(task.frequency_days) : null },
  }, 201)
})

// ─── PATCH /tasks/reorder (must come before :id) ───────────────────────────────

app.put('/reorder', async (c) => {
  const userId = await getAuthedUserId(c, c.env)
  if (!userId) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const body = await c.req.json().catch(() => null)
  const parsed = ReorderSchema.safeParse(body)
  if (!parsed.success) return err('VALIDATION_ERROR', 'Invalid input')

  const db = getDB(c.env.DB)

  // Verify all task IDs belong to this user
  const tasks = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.user_id, userId), inArray(schema.tasks.id, parsed.data.task_ids)))
    .all()

  if (tasks.length !== parsed.data.task_ids.length) {
    return err('FORBIDDEN', 'One or more tasks not found', 404)
  }

  // Update sort_order for each task
  for (let i = 0; i < parsed.data.task_ids.length; i++) {
    await db
      .update(schema.tasks)
      .set({ sort_order: i })
      .where(and(eq(schema.tasks.id, parsed.data.task_ids[i]), eq(schema.tasks.user_id, userId)))
  }

  return ok(null)
})

// ─── PATCH /tasks/:id ──────────────────────────────────────────────────────────

app.patch('/:id', async (c) => {
  const userId = await getAuthedUserId(c, c.env)
  if (!userId) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const taskId = c.req.param('id')
  const body = await c.req.json().catch(() => null)
  const parsed = UpdateTaskSchema.safeParse(body)
  if (!parsed.success) return err('VALIDATION_ERROR', 'Invalid input')

  const db = getDB(c.env.DB)

  // IDOR: verify task belongs to user
  const existing = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.user_id, userId)))
    .get()

  if (!existing) return err('NOT_FOUND', 'Task not found', 404)

  const updates: Partial<typeof schema.tasks.$inferInsert> = {
    updated_at: new Date().toISOString(),
  }
  if (parsed.data.name !== undefined) updates.name = stripHTML(parsed.data.name)
  if (parsed.data.frequency_type !== undefined) updates.frequency_type = parsed.data.frequency_type
  if (parsed.data.frequency_days !== undefined) {
    updates.frequency_days = parsed.data.frequency_days ? JSON.stringify(parsed.data.frequency_days) : null
  }
  if (parsed.data.data_type !== undefined) updates.data_type = parsed.data.data_type
  if (parsed.data.data_label !== undefined) {
    updates.data_label = parsed.data.data_label ? stripHTML(parsed.data.data_label) : null
  }
  if (parsed.data.status !== undefined) updates.status = parsed.data.status
  if (parsed.data.sort_order !== undefined) updates.sort_order = parsed.data.sort_order

  await db
    .update(schema.tasks)
    .set(updates)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.user_id, userId)))

  const task = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get()
  return ok({ task: { ...task!, frequency_days: task!.frequency_days ? JSON.parse(task!.frequency_days) : null } })
})

// ─── DELETE /tasks/:id ─────────────────────────────────────────────────────────

app.delete('/:id', async (c) => {
  const userId = await getAuthedUserId(c, c.env)
  if (!userId) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const taskId = c.req.param('id')
  const db = getDB(c.env.DB)

  const existing = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.user_id, userId)))
    .get()

  if (!existing) return err('NOT_FOUND', 'Task not found', 404)

  await db
    .update(schema.tasks)
    .set({ status: 'archived', updated_at: new Date().toISOString() })
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.user_id, userId)))

  return ok(null)
})

// ─── PATCH /tasks/:id/pause ────────────────────────────────────────────────────

app.patch('/:id/pause', async (c) => {
  const userId = await getAuthedUserId(c, c.env)
  if (!userId) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const taskId = c.req.param('id')
  const db = getDB(c.env.DB)

  const existing = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.user_id, userId)))
    .get()

  if (!existing) return err('NOT_FOUND', 'Task not found', 404)

  await db
    .update(schema.tasks)
    .set({ status: 'paused', paused_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.user_id, userId)))

  const task = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get()
  return ok({ task: { ...task!, frequency_days: task!.frequency_days ? JSON.parse(task!.frequency_days) : null } })
})

// ─── PATCH /tasks/:id/resume ───────────────────────────────────────────────────

app.patch('/:id/resume', async (c) => {
  const userId = await getAuthedUserId(c, c.env)
  if (!userId) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const taskId = c.req.param('id')
  const db = getDB(c.env.DB)

  const existing = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.user_id, userId)))
    .get()

  if (!existing) return err('NOT_FOUND', 'Task not found', 404)

  await db
    .update(schema.tasks)
    .set({ status: 'active', paused_at: null, updated_at: new Date().toISOString() })
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.user_id, userId)))

  const task = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get()
  return ok({ task: { ...task!, frequency_days: task!.frequency_days ? JSON.parse(task!.frequency_days) : null } })
})
