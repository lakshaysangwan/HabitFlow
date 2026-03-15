import type { DB } from './db'
import { schema } from './db'
import { eq } from 'drizzle-orm'

interface RateLimitConfig {
  limit: number
  windowSeconds: number
}

/**
 * Check and increment rate limit counter using D1.
 * Returns true if the request is ALLOWED, false if rate limited.
 */
export async function checkRateLimit(
  db: DB,
  key: string,
  config: RateLimitConfig
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000)
  const windowStart = now - config.windowSeconds

  // Try to get existing record
  const existing = await db
    .select()
    .from(schema.rate_limits)
    .where(eq(schema.rate_limits.key, key))
    .get()

  if (!existing || existing.window_start < windowStart) {
    // No record or window expired — insert/replace with count=1
    await db
      .insert(schema.rate_limits)
      .values({ key, count: 1, window_start: now })
      .onConflictDoUpdate({
        target: schema.rate_limits.key,
        set: { count: 1, window_start: now },
      })
    return true
  }

  if (existing.count >= config.limit) {
    return false // Rate limited
  }

  // Increment counter
  await db
    .update(schema.rate_limits)
    .set({ count: existing.count + 1 })
    .where(eq(schema.rate_limits.key, key))

  return true
}
