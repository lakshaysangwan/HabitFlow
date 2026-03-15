import type { DB } from './db'
import { schema } from './db'

type EventType =
  | 'login_success'
  | 'login_fail'
  | 'register'
  | 'password_change'
  | 'logout'
  | 'god_access'
  | 'token_revoke'

interface AuditData {
  user_id?: string
  ip_address?: string
  user_agent?: string
  metadata?: Record<string, unknown>
}

export async function logEvent(
  db: DB,
  event_type: EventType,
  data: AuditData = {}
): Promise<void> {
  try {
    await db.insert(schema.audit_log).values({
      event_type,
      user_id: data.user_id ?? null,
      ip_address: data.ip_address ?? null,
      user_agent: data.user_agent ? data.user_agent.slice(0, 200) : null,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
    })
  } catch {
    // Audit log failure must not break the main flow
    console.error('Audit log failed:', event_type)
  }
}
