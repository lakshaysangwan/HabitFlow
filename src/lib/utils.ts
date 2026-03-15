import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format a Date or ISO string to YYYY-MM-DD in local timezone */
export function toDateString(date: Date | string = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-CA') // en-CA gives YYYY-MM-DD
}

/** Parse YYYY-MM-DD as local date (not UTC) */
export function fromDateString(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Format date for display: "Today, Mon 15 Mar" or "Mon 14 Mar" */
export function formatDisplayDate(dateStr: string): string {
  const today = toDateString()
  const yesterday = toDateString(new Date(Date.now() - 86400000))
  const date = fromDateString(dateStr)
  const formatted = date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  if (dateStr === today) return `Today, ${formatted}`
  if (dateStr === yesterday) return `Yesterday, ${formatted}`
  return formatted
}

/** ISO weekday 1=Mon..7=Sun for a YYYY-MM-DD string */
export function getISOWeekday(dateStr: string): number {
  const d = fromDateString(dateStr)
  const day = d.getDay() // 0=Sun..6=Sat
  return day === 0 ? 7 : day
}
