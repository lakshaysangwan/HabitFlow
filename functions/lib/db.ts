import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../../drizzle/schema'

export type DB = ReturnType<typeof getDB>

export function getDB(d1: D1Database) {
  return drizzle(d1, { schema })
}

export { schema }
