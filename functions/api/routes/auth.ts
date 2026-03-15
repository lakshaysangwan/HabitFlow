/**
 * Auth API — Cloudflare Pages Functions
 * Handles: POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me,
 *          PATCH /api/auth/password, PATCH /api/auth/profile
 *
 * Cloudflare Pages Functions file routing:
 *   /functions/api/auth.ts → handles /api/auth
 *   But sub-paths like /api/auth/login need /functions/api/auth/login.ts
 *   OR we use a catch-all with Hono: /functions/api/auth/[[route]].ts
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { getDB, schema } from '../../lib/db'
import { hashPassword, verifyPassword } from '../../lib/crypto'
import { signJWT, makeTokenCookie, clearTokenCookie } from '../../lib/jwt'
import { checkRateLimit } from '../../lib/rate-limit'
import { logEvent } from '../../lib/audit'
import { ok, err } from '../../lib/response'
import type { Env } from '../../lib/env'

export const app = new Hono<{ Bindings: Env }>()

// ─── Schemas ─────────────────────────────────────────────────────────────────

const LoginSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(128),
  invite_code: z.string().min(4).max(50).optional(),
})

const ChangePasswordSchema = z.object({
  old_password: z.string().min(1),
  new_password: z.string().min(8).max(128),
  confirm_password: z.string().min(1),
})

const UpdateProfileSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  timezone: z.string().min(1).max(100).optional(),
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getIP(req: Request): string {
  return req.headers.get('CF-Connecting-IP') ?? req.headers.get('X-Forwarded-For') ?? 'unknown'
}

function getUserAgent(req: Request): string {
  return (req.headers.get('User-Agent') ?? '').slice(0, 200)
}

function stripHTML(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/[\x00-\x1F]/g, '').trim()
}

function safeUser(user: typeof schema.users.$inferSelect) {
  const { password_hash, token_version, ...out } = user
  return out
}

// ─── POST /login ──────────────────────────────────────────────────────────────

app.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = LoginSchema.safeParse(body)
  if (!parsed.success) return err('VALIDATION_ERROR', 'Invalid input')

  const { username, password, invite_code } = parsed.data
  const db = getDB(c.env.DB)
  const ip = getIP(c.req.raw)
  const ua = getUserAgent(c.req.raw)

  const allowed = await checkRateLimit(db, `auth:${ip}`, { limit: 5, windowSeconds: 60 })
  if (!allowed) return err('RATE_LIMITED', 'Too many requests. Please wait a moment.', 429)

  const existingUser = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .get()

  if (existingUser) {
    const valid = await verifyPassword(existingUser.password_hash, password)
    if (!valid) {
      await logEvent(db, 'login_fail', { ip_address: ip, user_agent: ua, metadata: { username } })
      return err('INVALID_CREDENTIALS', 'Invalid credentials', 401)
    }

    const token = await signJWT(
      { sub: existingUser.id, username: existingUser.username, is_god: existingUser.is_god, token_version: existingUser.token_version },
      c.env
    )
    await logEvent(db, 'login_success', { user_id: existingUser.id, ip_address: ip, user_agent: ua })

    return new Response(JSON.stringify({ ok: true, data: { user: safeUser(existingUser) } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': makeTokenCookie(token, c.env) },
    })
  }

  // Register
  if (!invite_code) {
    return err('INVITE_REQUIRED', 'User not found. Need an invite code to create an account.', 401)
  }

  const code = await db
    .select()
    .from(schema.invite_codes)
    .where(eq(schema.invite_codes.code, invite_code))
    .get()

  if (!code || code.current_uses >= code.max_uses) {
    return err('INVALID_INVITE', 'Invalid or exhausted invite code.', 400)
  }

  const password_hash = await hashPassword(password)
  const userId = crypto.randomUUID().replace(/-/g, '')

  await db.insert(schema.users).values({
    id: userId,
    username,
    password_hash,
    display_name: stripHTML(username),
    timezone: 'Asia/Kolkata',
    is_god: 0,
    theme: 'system',
    token_version: 0,
  })

  await c.env.DB.prepare(
    'UPDATE invite_codes SET current_uses = current_uses + 1 WHERE code = ?'
  ).bind(invite_code).run()

  const newUser = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get()
  if (!newUser) return err('SERVER_ERROR', 'Failed to create account', 500)

  const token = await signJWT(
    { sub: newUser.id, username: newUser.username, is_god: 0, token_version: 0 },
    c.env
  )
  await logEvent(db, 'register', { user_id: newUser.id, ip_address: ip, user_agent: ua, metadata: { invite_code } })

  return new Response(JSON.stringify({ ok: true, data: { user: safeUser(newUser) } }), {
    status: 201,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': makeTokenCookie(token, c.env) },
  })
})

// ─── POST /logout ──────────────────────────────────────────────────────────────

app.post('/logout', async (c) => {
  const cookieHeader = c.req.header('Cookie') ?? ''
  const tokenMatch = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/)
  const token = tokenMatch?.[1]

  if (token) {
    const db = getDB(c.env.DB)
    const { verifyJWT } = await import('../../lib/jwt')
    const payload = await verifyJWT(token, c.env)
    if (payload) {
      await logEvent(db, 'logout', { user_id: payload.sub, ip_address: getIP(c.req.raw) })
    }
  }

  return new Response(JSON.stringify({ ok: true, data: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearTokenCookie() },
  })
})

// ─── GET /me ───────────────────────────────────────────────────────────────────

app.get('/me', async (c) => {
  // userId injected by middleware
  const userId = (c.env as unknown as Record<string, string>)['__userId'] ??
    c.req.header('X-User-Id')

  // Actually, middleware puts userId in context.data, which we can't directly access in Hono
  // We'll re-verify JWT here for now
  const cookieHeader = c.req.header('Cookie') ?? ''
  const tokenMatch = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/)
  const token = tokenMatch?.[1]
  if (!token) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const { verifyJWT } = await import('../../lib/jwt')
  const payload = await verifyJWT(token, c.env)
  if (!payload) return err('UNAUTHORIZED', 'Invalid session', 401)

  const db = getDB(c.env.DB)
  const user = await db.select().from(schema.users).where(eq(schema.users.id, payload.sub)).get()
  if (!user) return err('USER_NOT_FOUND', 'User not found', 404)

  return ok({ user: safeUser(user) })
})

// ─── PATCH /password ───────────────────────────────────────────────────────────

app.patch('/password', async (c) => {
  const cookieHeader = c.req.header('Cookie') ?? ''
  const tokenMatch = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/)
  const token = tokenMatch?.[1]
  if (!token) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const { verifyJWT } = await import('../../lib/jwt')
  const payload = await verifyJWT(token, c.env)
  if (!payload) return err('UNAUTHORIZED', 'Invalid session', 401)

  const userId = payload.sub
  const body = await c.req.json().catch(() => null)
  const parsed = ChangePasswordSchema.safeParse(body)
  if (!parsed.success) return err('VALIDATION_ERROR', 'Invalid input')

  const { old_password, new_password, confirm_password } = parsed.data
  const db = getDB(c.env.DB)
  const ip = getIP(c.req.raw)

  const allowed = await checkRateLimit(db, `password:${userId}`, { limit: 5, windowSeconds: 60 })
  if (!allowed) return err('RATE_LIMITED', 'Too many requests.', 429)

  if (new_password !== confirm_password) return err('VALIDATION_ERROR', 'Passwords do not match')

  const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get()
  if (!user) return err('USER_NOT_FOUND', 'User not found', 404)

  const valid = await verifyPassword(user.password_hash, old_password)
  if (!valid) return err('INVALID_PASSWORD', 'Current password is incorrect', 400)

  const isSame = await verifyPassword(user.password_hash, new_password)
  if (isSame) return err('SAME_PASSWORD', 'New password must differ from current', 400)

  const newHash = await hashPassword(new_password)
  const newVersion = user.token_version + 1

  await db
    .update(schema.users)
    .set({ password_hash: newHash, token_version: newVersion, updated_at: new Date().toISOString() })
    .where(eq(schema.users.id, userId))

  await logEvent(db, 'password_change', { user_id: userId, ip_address: ip })
  await logEvent(db, 'token_revoke', { user_id: userId, metadata: { reason: 'password_change' } })

  const newToken = await signJWT(
    { sub: userId, username: user.username, is_god: user.is_god, token_version: newVersion },
    c.env
  )

  return new Response(JSON.stringify({ ok: true, data: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': makeTokenCookie(newToken, c.env) },
  })
})

// ─── PATCH /profile ────────────────────────────────────────────────────────────

app.patch('/profile', async (c) => {
  const cookieHeader = c.req.header('Cookie') ?? ''
  const tokenMatch = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/)
  const token = tokenMatch?.[1]
  if (!token) return err('UNAUTHORIZED', 'Not authenticated', 401)

  const { verifyJWT } = await import('../../lib/jwt')
  const payload = await verifyJWT(token, c.env)
  if (!payload) return err('UNAUTHORIZED', 'Invalid session', 401)

  const body = await c.req.json().catch(() => null)
  const parsed = UpdateProfileSchema.safeParse(body)
  if (!parsed.success) return err('VALIDATION_ERROR', 'Invalid input')

  const updates: Partial<typeof schema.users.$inferInsert> = {}
  if (parsed.data.display_name) {
    updates.display_name = parsed.data.display_name.replace(/<[^>]*>/g, '').trim()
  }
  if (parsed.data.timezone) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: parsed.data.timezone })
      updates.timezone = parsed.data.timezone
    } catch {
      return err('INVALID_TIMEZONE', 'Invalid timezone')
    }
  }

  if (Object.keys(updates).length === 0) return err('NO_CHANGES', 'Nothing to update')

  const db = getDB(c.env.DB)
  await db
    .update(schema.users)
    .set({ ...updates, updated_at: new Date().toISOString() })
    .where(eq(schema.users.id, payload.sub))

  const user = await db.select().from(schema.users).where(eq(schema.users.id, payload.sub)).get()
  if (!user) return err('USER_NOT_FOUND', 'User not found', 404)

  return ok({ user: safeUser(user) })
})
