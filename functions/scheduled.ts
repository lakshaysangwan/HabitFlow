/**
 * Scheduled Worker — Cloudflare Cron Trigger
 * Runs daily at 02:00 UTC to purge audit_log entries older than 90 days.
 *
 * To enable, update wrangler.toml to add:
 *   [triggers]
 *   crons = ["0 2 * * *"]
 *
 * And bind this file as a Worker (separate from Pages Functions).
 */

import type { Env } from './lib/env'
import { getDB, schema } from './lib/db'
import { lt, sql } from 'drizzle-orm'

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    const db = getDB(env.DB)

    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
    const cutoff = ninetyDaysAgo.toISOString()

    const result = await db
      .delete(schema.audit_log)
      .where(lt(schema.audit_log.created_at, cutoff))
      .run()

    console.log(`Purged audit logs older than ${cutoff}. Rows deleted: ${result.meta?.changes ?? 'unknown'}`)

    // Also clean up stale rate_limit entries (older than 10 minutes)
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600
    await db
      .delete(schema.rate_limits)
      .where(lt(schema.rate_limits.window_start, tenMinutesAgo))
      .run()
  },
}
