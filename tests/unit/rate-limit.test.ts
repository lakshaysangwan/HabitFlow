import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { checkRateLimit } from '../../functions/lib/rate-limit'
import { applyMigrations } from '../helpers'

beforeAll(async () => {
  await applyMigrations(env.DB)
})

describe('checkRateLimit', () => {
  it('allows requests within the limit', async () => {
    const key = `test-rl-${Date.now()}`

    for (let i = 0; i < 5; i++) {
      expect(await checkRateLimit(env.DB, key, { limit: 5, windowSeconds: 60 })).toBe(true)
    }
  })

  it('blocks the (limit + 1)th request', async () => {
    const key = `test-rl-block-${Date.now()}`

    for (let i = 0; i < 5; i++) {
      await checkRateLimit(env.DB, key, { limit: 5, windowSeconds: 60 })
    }
    expect(await checkRateLimit(env.DB, key, { limit: 5, windowSeconds: 60 })).toBe(false)
  })

  it('different keys do not interfere', async () => {
    const ts = Date.now()
    const keyA = `key-a-${ts}`
    const keyB = `key-b-${ts}`

    // Max out key A
    for (let i = 0; i < 3; i++) {
      await checkRateLimit(env.DB, keyA, { limit: 3, windowSeconds: 60 })
    }
    expect(await checkRateLimit(env.DB, keyA, { limit: 3, windowSeconds: 60 })).toBe(false)

    // Key B should still be free
    expect(await checkRateLimit(env.DB, keyB, { limit: 3, windowSeconds: 60 })).toBe(true)
  })

  it('resets count when window expires', async () => {
    const key = `test-rl-reset-${Date.now()}`

    // Max out with a 1-second window
    for (let i = 0; i < 2; i++) {
      await checkRateLimit(env.DB, key, { limit: 2, windowSeconds: 1 })
    }
    expect(await checkRateLimit(env.DB, key, { limit: 2, windowSeconds: 1 })).toBe(false)

    // Manually expire the window by setting window_start to past
    await env.DB.prepare(
      `UPDATE rate_limits SET window_start = ? WHERE key = ?`
    ).bind(Math.floor(Date.now() / 1000) - 10, key).run()

    // Should be allowed again
    expect(await checkRateLimit(env.DB, key, { limit: 2, windowSeconds: 1 })).toBe(true)
  })

  it('first request for a new key is always allowed', async () => {
    const key = `brand-new-${Date.now()}-${Math.random()}`
    expect(await checkRateLimit(env.DB, key, { limit: 1, windowSeconds: 60 })).toBe(true)
  })
})
