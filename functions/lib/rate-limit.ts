interface RateLimitConfig {
  limit: number
  windowSeconds: number
}

/**
 * Check and increment rate limit counter using a single atomic D1 UPSERT.
 * Returns true if the request is ALLOWED, false if rate limited.
 *
 * Uses raw D1 instead of Drizzle because Drizzle's onConflictDoUpdate
 * doesn't support CASE expressions in the SET clause.
 */
export async function checkRateLimit(
  db: D1Database,
  key: string,
  config: RateLimitConfig
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000)
  const windowStart = now - config.windowSeconds

  // Single atomic UPSERT:
  // - If no row exists: insert with count=1
  // - If window has expired: reset count to 1
  // - If count is already at the limit: set to limit+1 (marks as blocked, never increments past that)
  // - Otherwise: increment by 1
  // RETURNING count lets us check in one round-trip.
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE
           WHEN window_start < ?  THEN 1
           WHEN count >= ?        THEN ? + 1
           ELSE count + 1
         END,
         window_start = CASE
           WHEN window_start < ?  THEN ?
           ELSE window_start
         END
       RETURNING count`
    )
    .bind(key, now, windowStart, config.limit, config.limit, windowStart, now)
    .first<{ count: number }>()

  return (row?.count ?? 1) <= config.limit
}
