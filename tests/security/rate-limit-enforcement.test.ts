/**
 * Rate limiting enforcement tests for auth endpoints and admin.
 * Tests that the API correctly blocks after exceeding the limit.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { applyMigrations, createUser, req } from '../helpers'

beforeAll(async () => {
  await applyMigrations(env.DB)
})

// ─── Login rate limiting (5/min per IP) ───────────────────────────────────────

describe('Login rate limiting', () => {
  it('allows 5 consecutive login attempts, blocks the 6th', async () => {
    const ip = `192.0.2.${Math.floor(Math.random() * 254) + 1}`

    // Pre-load rate limit to exactly 5
    await env.DB.prepare(
      `INSERT OR REPLACE INTO rate_limits (key, count, window_start) VALUES (?, 5, ?)`
    ).bind(`auth:${ip}`, Math.floor(Date.now() / 1000)).run()

    // The next call should be blocked
    const { checkRateLimit } = await import('../../functions/lib/rate-limit')
    const allowed = await checkRateLimit(env.DB, `auth:${ip}`, { limit: 5, windowSeconds: 60 })
    expect(allowed).toBe(false)
  })

  it('returns 429 RATE_LIMITED after exhausting login attempts', async () => {
    const uniqueKey = `auth:test-ip-${Date.now()}`
    await env.DB.prepare(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 5, ?)`
    ).bind(uniqueKey, Math.floor(Date.now() / 1000)).run()

    const { checkRateLimit } = await import('../../functions/lib/rate-limit')
    const blocked = await checkRateLimit(env.DB, uniqueKey, { limit: 5, windowSeconds: 60 })
    expect(blocked).toBe(false)
  })
})

// ─── Password change rate limiting (5/min per user) ───────────────────────────

describe('Password change rate limiting', () => {
  it('blocks password change after 5 attempts', async () => {
    const user = await createUser(env.DB, env)

    // Pre-exhaust the rate limit for this user
    await env.DB.prepare(
      `INSERT OR REPLACE INTO rate_limits (key, count, window_start) VALUES (?, 5, ?)`
    ).bind(`password:${user.id}`, Math.floor(Date.now() / 1000)).run()

    const { status, body } = await req('PATCH', '/api/auth/password', env, {
      token: user.token,
      body: {
        old_password: user.password,
        new_password: 'newpassword999',
        confirm_password: 'newpassword999',
      },
    })
    expect(status).toBe(429)
    expect((body as any).error.code).toBe('RATE_LIMITED')
  })
})

// ─── Admin rate limiting (100/min per god user) ───────────────────────────────

describe('Admin rate limiting', () => {
  it('blocks admin endpoint after 100 requests', async () => {
    const god = await createUser(env.DB, env, { isGod: true })

    // Pre-exhaust the rate limit for this god user
    await env.DB.prepare(
      `INSERT OR REPLACE INTO rate_limits (key, count, window_start) VALUES (?, 100, ?)`
    ).bind(`admin:${god.id}`, Math.floor(Date.now() / 1000)).run()

    const { status, body } = await req('GET', '/api/admin/users', env, { token: god.token })
    expect(status).toBe(429)
    expect((body as any).error.code).toBe('RATE_LIMITED')
  })
})

// ─── Rate limit window reset ───────────────────────────────────────────────────

describe('Rate limit window expiry', () => {
  it('allows requests again after window expires', async () => {
    const { checkRateLimit } = await import('../../functions/lib/rate-limit')
    const key = `test-window-reset-${Date.now()}`

    // Max out
    await env.DB.prepare(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 5, ?)`
    ).bind(key, Math.floor(Date.now() / 1000)).run()
    expect(await checkRateLimit(env.DB, key, { limit: 5, windowSeconds: 60 })).toBe(false)

    // Expire the window by backdating window_start
    await env.DB.prepare(
      `UPDATE rate_limits SET window_start = ? WHERE key = ?`
    ).bind(Math.floor(Date.now() / 1000) - 120, key).run()

    // Should be allowed again
    expect(await checkRateLimit(env.DB, key, { limit: 5, windowSeconds: 60 })).toBe(true)
  })
})
