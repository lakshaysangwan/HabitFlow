/**
 * God Mode / Admin API routes (requires is_god=1)
 * GET  /api/admin/users?search=&page=&limit=
 * GET  /api/admin/users/:id
 * GET  /api/admin/users/:id/analytics?range=
 * POST /api/admin/invite-codes
 * GET  /api/admin/invite-codes
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, gte, lte, sql } from 'drizzle-orm'
import { getDB, schema } from '../../lib/db'
import { ok, err } from '../../lib/response'
import { verifyJWT } from '../../lib/jwt'
import { logEvent } from '../../lib/audit'
import { checkRateLimit } from '../../lib/rate-limit'
import { getDateRange, dateRange, isTaskScheduled, calcStreaks, type Range } from '../../lib/analytics-helpers'
import type { Env } from '../../lib/env'

export const app = new Hono<{ Bindings: Env }>()

interface GodPayload {
  sub: string
  is_god: number
}

async function getGodUser(
  c: { req: { header: (k: string) => string | undefined } },
  env: Env
): Promise<GodPayload | null> {
  const cookie = c.req.header('Cookie') ?? ''
  const m = cookie.match(/(?:^|;\s*)token=([^;]+)/)
  if (!m) return null
  const payload = await verifyJWT(m[1], env)
  if (!payload || payload.is_god !== 1) return null
  return payload
}

function getIP(req: Request): string {
  return req.headers.get('CF-Connecting-IP') ?? req.headers.get('X-Forwarded-For') ?? 'unknown'
}

function safeUser(user: typeof schema.users.$inferSelect) {
  const { password_hash, token_version, ...out } = user
  return out
}

const CreateInviteCodeSchema = z.object({
  code: z.string().min(4).max(50).regex(/^[A-Z0-9_-]+$/),
  max_uses: z.number().int().min(1).max(1000).default(10),
})

// ─── GET /admin/users ─────────────────────────────────────────────────────────

app.get('/users', async (c) => {
  const god = await getGodUser(c, c.env)
  if (!god) return err('FORBIDDEN', 'God mode required', 403)

  const db = getDB(c.env.DB)

  // Rate limit: 20/min
  const allowed = await checkRateLimit(c.env.DB, `admin:${god.sub}`, { limit: 100, windowSeconds: 60 })
  if (!allowed) return err('RATE_LIMITED', 'Too many requests', 429)

  const search = c.req.query('search') ?? ''
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10))
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10)))
  const offset = (page - 1) * limit

  let users
  if (search) {
    const pattern = `%${search.replace(/%/g, '\\%')}%`
    users = await db
      .select()
      .from(schema.users)
      .where(sql`(${schema.users.username} LIKE ${pattern} ESCAPE '\\' OR ${schema.users.display_name} LIKE ${pattern} ESCAPE '\\')`)
      .limit(limit)
      .offset(offset)
      .all()
  } else {
    users = await db
      .select()
      .from(schema.users)
      .limit(limit)
      .offset(offset)
      .all()
  }

  await logEvent(db, 'god_access', {
    user_id: god.sub,
    ip_address: getIP(c.req.raw),
    metadata: { action: 'search_users', search },
  })

  return ok({ users: users.map(safeUser), page, limit })
})

// ─── GET /admin/users/:id ──────────────────────────────────────────────────────

app.get('/users/:id', async (c) => {
  const god = await getGodUser(c, c.env)
  if (!god) return err('FORBIDDEN', 'God mode required', 403)

  const targetId = c.req.param('id')
  const db = getDB(c.env.DB)

  const allowed = await checkRateLimit(c.env.DB, `admin:${god.sub}`, { limit: 100, windowSeconds: 60 })
  if (!allowed) return err('RATE_LIMITED', 'Too many requests', 429)

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const startDate = thirtyDaysAgo.toLocaleDateString('en-CA')

  const [user, tasks, recentCompletions] = await Promise.all([
    db.select().from(schema.users).where(eq(schema.users.id, targetId)).get(),
    db.select().from(schema.tasks).where(eq(schema.tasks.user_id, targetId)).all(),
    db.select().from(schema.completions)
      .where(and(
        eq(schema.completions.user_id, targetId),
        sql`${schema.completions.completed_date} >= ${startDate}`
      ))
      .orderBy(sql`${schema.completions.completed_date} DESC`)
      .limit(100)
      .all(),
  ])

  if (!user) return err('NOT_FOUND', 'User not found', 404)

  await logEvent(db, 'god_access', {
    user_id: god.sub,
    ip_address: getIP(c.req.raw),
    metadata: { action: 'view_user', target_user_id: targetId },
  })

  return ok({
    user: safeUser(user),
    tasks: tasks.map(t => ({ ...t, frequency_days: t.frequency_days ? JSON.parse(t.frequency_days) : null })),
    recent_completions: recentCompletions,
  })
})

// ─── GET /admin/users/:id/analytics ───────────────────────────────────────────

app.get('/users/:id/analytics', async (c) => {
  const god = await getGodUser(c, c.env)
  if (!god) return err('FORBIDDEN', 'God mode required', 403)

  const targetId = c.req.param('id')
  const range = (c.req.query('range') ?? 'month') as Range
  if (!['week', 'month', 'year', 'all'].includes(range)) return err('VALIDATION_ERROR', 'Invalid range')

  const db = getDB(c.env.DB)

  const allowed = await checkRateLimit(c.env.DB, `admin:${god.sub}`, { limit: 100, windowSeconds: 60 })
  if (!allowed) return err('RATE_LIMITED', 'Too many requests', 429)

  const targetUser = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, targetId)).get()
  if (!targetUser) return err('NOT_FOUND', 'User not found', 404)

  await logEvent(db, 'god_access', {
    user_id: god.sub,
    ip_address: getIP(c.req.raw),
    metadata: { action: 'view_analytics', target_user_id: targetId, range },
  })

  const { start, end } = getDateRange(range)

  const [tasks, completions] = await Promise.all([
    db.select().from(schema.tasks).where(eq(schema.tasks.user_id, targetId)).all(),
    db.select().from(schema.completions)
      .where(and(
        eq(schema.completions.user_id, targetId),
        gte(schema.completions.completed_date, start),
        lte(schema.completions.completed_date, end)
      ))
      .all(),
  ])

  const completionSet = new Set(completions.map(c => `${c.task_id}:${c.completed_date}`))
  const dates = dateRange(start, end)

  const daily_rates = dates.map(date => {
    const scheduled = tasks.filter(t => isTaskScheduled(t, date))
    const done = scheduled.filter(t => completionSet.has(`${t.id}:${date}`))
    return {
      date,
      rate: scheduled.length > 0 ? Math.round((done.length / scheduled.length) * 100) : 0,
      completed: done.length,
      total: scheduled.length,
    }
  })

  const streakEntries = daily_rates.map(d => ({
    date: d.date,
    completed: d.total > 0 ? d.completed === d.total : false,
  }))
  const { current_streak, best_streak } = calcStreaks(streakEntries)

  const task_breakdown = tasks
    .filter(t => t.status !== 'archived')
    .map(t => {
      const scheduled = dates.filter(d => isTaskScheduled(t, d))
      const done = scheduled.filter(d => completionSet.has(`${t.id}:${d}`))
      return {
        task_id: t.id,
        task_name: t.name,
        task_color: t.color,
        completion_rate: scheduled.length > 0 ? Math.round((done.length / scheduled.length) * 100) : 0,
        total_completed: done.length,
      }
    })

  const activeDays = daily_rates.filter(d => d.total > 0)
  const avg_daily_rate = activeDays.length > 0
    ? Math.round(activeDays.reduce((s, d) => s + d.rate, 0) / activeDays.length)
    : 0

  return ok({
    range,
    target_user_id: targetId,
    daily_rates,
    current_streak,
    best_streak,
    total_completions: completions.length,
    avg_daily_rate,
    task_breakdown,
  })
})

// ─── POST /admin/invite-codes ──────────────────────────────────────────────────

app.post('/invite-codes', async (c) => {
  const god = await getGodUser(c, c.env)
  if (!god) return err('FORBIDDEN', 'God mode required', 403)

  const body = await c.req.json().catch(() => null)
  const parsed = CreateInviteCodeSchema.safeParse(body)
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Invalid input. Code must be uppercase alphanumeric/dash/underscore (4-50 chars)')
  }

  const db = getDB(c.env.DB)

  const allowed = await checkRateLimit(c.env.DB, `admin:${god.sub}`, { limit: 100, windowSeconds: 60 })
  if (!allowed) return err('RATE_LIMITED', 'Too many requests', 429)

  // Check for duplicate code
  const existing = await db
    .select()
    .from(schema.invite_codes)
    .where(eq(schema.invite_codes.code, parsed.data.code))
    .get()

  if (existing) return err('DUPLICATE_CODE', 'Invite code already exists', 409)

  const codeId = crypto.randomUUID().replace(/-/g, '')
  await db.insert(schema.invite_codes).values({
    id: codeId,
    code: parsed.data.code,
    max_uses: parsed.data.max_uses,
    current_uses: 0,
    created_by: god.sub,
  })

  const inviteCode = await db
    .select()
    .from(schema.invite_codes)
    .where(eq(schema.invite_codes.id, codeId))
    .get()

  return ok({ invite_code: inviteCode }, 201)
})

// ─── GET /admin/invite-codes ───────────────────────────────────────────────────

app.get('/invite-codes', async (c) => {
  const god = await getGodUser(c, c.env)
  if (!god) return err('FORBIDDEN', 'God mode required', 403)

  const db = getDB(c.env.DB)

  const allowed = await checkRateLimit(c.env.DB, `admin:${god.sub}`, { limit: 100, windowSeconds: 60 })
  if (!allowed) return err('RATE_LIMITED', 'Too many requests', 429)

  const invite_codes = await db
    .select()
    .from(schema.invite_codes)
    .orderBy(sql`${schema.invite_codes.created_at} DESC`)
    .all()

  return ok({ invite_codes })
})
