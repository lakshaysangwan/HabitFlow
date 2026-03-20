/**
 * Module-level token_version cache for JWT revocation checks.
 * Lives in the Cloudflare Workers isolate instance — shared across concurrent
 * requests within the same isolate, reset on cold start.
 *
 * Security model:
 * - Cache entry stores the DB's authoritative token_version for a userId.
 * - If payload.token_version !== cached version → token is revoked (immediate).
 * - If no cache entry → DB query is performed (same as before).
 * - Cache is explicitly invalidated on logout and password change → immediate revocation.
 * - TTL (60s) is the fallback max staleness window for edge cases.
 */

const cache = new Map<string, { version: number; expiresAt: number }>()
const TTL_MS = 60_000

/**
 * Check the cache for a user's token version.
 * Returns true (valid), false (revoked), or null (cache miss → must query DB).
 */
export function checkTokenCache(userId: string, payloadVersion: number): boolean | null {
  const entry = cache.get(userId)
  if (!entry || Date.now() > entry.expiresAt) return null
  return entry.version === payloadVersion
}

/**
 * Store the DB-authoritative token version after a successful DB lookup.
 */
export function setTokenCache(userId: string, dbVersion: number): void {
  cache.set(userId, { version: dbVersion, expiresAt: Date.now() + TTL_MS })
}

/**
 * Invalidate the cache entry for a user immediately.
 * Call this after password change or logout.
 */
export function invalidateTokenCache(userId: string): void {
  cache.delete(userId)
}
