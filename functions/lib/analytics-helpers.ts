/**
 * Shared analytics helpers — used by analytics.ts and admin.ts
 */
import { schema } from './db'

export type Range = 'week' | 'month' | 'year' | 'all'

export function getDateRange(range: Range): { start: string; end: string } {
  const today = new Date()
  const end = today.toLocaleDateString('en-CA')

  if (range === 'week') {
    const start = new Date(today)
    start.setDate(start.getDate() - 6)
    return { start: start.toLocaleDateString('en-CA'), end }
  }
  if (range === 'month') {
    const start = new Date(today)
    start.setDate(start.getDate() - 29)
    return { start: start.toLocaleDateString('en-CA'), end }
  }
  if (range === 'year') {
    const start = new Date(today)
    start.setFullYear(start.getFullYear() - 1)
    return { start: start.toLocaleDateString('en-CA'), end }
  }
  return { start: '2020-01-01', end }
}

/** Generate array of YYYY-MM-DD strings between start and end (inclusive) */
export function dateRange(start: string, end: string): string[] {
  const dates: string[] = []
  const cur = new Date(start + 'T12:00:00')
  const endDate = new Date(end + 'T12:00:00')
  while (cur <= endDate) {
    dates.push(cur.toLocaleDateString('en-CA'))
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

/** Check if a task is scheduled on a given date */
export function isTaskScheduled(task: typeof schema.tasks.$inferSelect, date: string): boolean {
  if (task.status === 'archived') return false
  if (date < task.start_date) return false
  if (task.paused_at && date >= task.paused_at.slice(0, 10)) return false

  if (task.frequency_type === 'weekly' && task.frequency_days) {
    const days: number[] = JSON.parse(task.frequency_days)
    const d = new Date(date + 'T12:00:00')
    const dow = d.getDay() === 0 ? 7 : d.getDay()
    return days.includes(dow)
  }
  return true
}

/** Pre-parse frequency_days once per task — pass result to isTaskScheduledFast */
export function parseTaskDays(task: typeof schema.tasks.$inferSelect): number[] | null {
  if (task.frequency_type !== 'weekly' || !task.frequency_days) return null
  return JSON.parse(task.frequency_days) as number[]
}

/** Like isTaskScheduled but accepts pre-parsed days to avoid JSON.parse in loops */
export function isTaskScheduledFast(
  task: typeof schema.tasks.$inferSelect,
  parsedDays: number[] | null,
  date: string
): boolean {
  if (task.status === 'archived') return false
  if (date < task.start_date) return false
  if (task.paused_at && date >= task.paused_at.slice(0, 10)) return false
  if (task.frequency_type === 'weekly' && parsedDays) {
    const d = new Date(date + 'T12:00:00')
    const dow = d.getDay() === 0 ? 7 : d.getDay()
    return parsedDays.includes(dow)
  }
  return true
}

/** Calculate current and best streaks from an ordered list of (date, completed) pairs */
export function calcStreaks(entries: Array<{ date: string; completed: boolean }>): {
  current_streak: number
  best_streak: number
} {
  let current_streak = 0
  let best_streak = 0
  let streak = 0

  const today = new Date().toLocaleDateString('en-CA')

  for (let i = entries.length - 1; i >= 0; i--) {
    const { completed } = entries[i]
    if (completed) {
      streak++
      if (i === entries.length - 1 || entries[i + 1].date <= today) {
        current_streak = streak
      }
    } else {
      break
    }
  }

  let run = 0
  for (const { completed } of entries) {
    if (completed) {
      run++
      best_streak = Math.max(best_streak, run)
    } else {
      run = 0
    }
  }

  return { current_streak, best_streak }
}
