/**
 * Analytics API routes
 * GET /api/analytics/daily?date=YYYY-MM-DD
 * GET /api/analytics/task/:id?range=week|month|year|all
 * GET /api/analytics/overview?range=week|month|year|all
 * GET /api/analytics/heatmap?year=YYYY
 */

import { Hono } from 'hono'
import { eq, and, gte, lte } from 'drizzle-orm'
import { getDB, schema } from '../../lib/db'
import { ok, err } from '../../lib/response'
import { getDateRange, dateRange, isTaskScheduled, isTaskScheduledFast, parseTaskDays, calcStreaks, type Range } from '../../lib/analytics-helpers'
import type { Env } from '../../lib/env'

type Variables = { userId: string; is_god: number }

export const app = new Hono<{ Bindings: Env; Variables: Variables }>()

// ─── GET /daily ────────────────────────────────────────────────────────────────

app.get('/daily', async (c) => {
  const userId = c.get('userId')

  const date = c.req.query('date') ?? new Date().toLocaleDateString('en-CA')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err('VALIDATION_ERROR', 'Invalid date')

  const db = getDB(c.env.DB)

  const [tasks, completions] = await Promise.all([
    db.select().from(schema.tasks).where(eq(schema.tasks.user_id, userId)).all(),
    db.select().from(schema.completions)
      .where(and(eq(schema.completions.user_id, userId), eq(schema.completions.completed_date, date)))
      .all(),
  ])

  const completionMap = new Map(completions.map(c => [c.task_id, c]))

  const scheduledTasks = tasks.filter(t => isTaskScheduled(t, date))
  const taskItems = scheduledTasks.map(t => {
    const c = completionMap.get(t.id)
    return {
      task_id: t.id,
      task_name: t.name,
      task_color: t.color,
      completed: !!c,
      completion_id: c?.id ?? null,
    }
  })

  const total = taskItems.length
  const completed = taskItems.filter(t => t.completed).length

  return ok({
    date,
    total,
    completed,
    rate: total > 0 ? Math.round((completed / total) * 100) : 0,
    tasks: taskItems,
  })
})

// ─── GET /task/:id ─────────────────────────────────────────────────────────────

app.get('/task/:id', async (c) => {
  const userId = c.get('userId')

  const taskId = c.req.param('id')
  const range = (c.req.query('range') ?? 'month') as Range
  if (!['week', 'month', 'year', 'all'].includes(range)) return err('VALIDATION_ERROR', 'Invalid range')

  const db = getDB(c.env.DB)

  // IDOR: verify task belongs to user
  const task = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.user_id, userId)))
    .get()

  if (!task) return err('NOT_FOUND', 'Task not found', 404)

  const { start, end } = getDateRange(range)
  const adjustedStart = start > task.start_date ? start : task.start_date

  const completions = await db
    .select()
    .from(schema.completions)
    .where(and(
      eq(schema.completions.task_id, taskId),
      eq(schema.completions.user_id, userId),
      gte(schema.completions.completed_date, adjustedStart),
      lte(schema.completions.completed_date, end)
    ))
    .all()

  const completionMap = new Map(completions.map(c => [c.completed_date, c]))
  const dates = dateRange(adjustedStart, end)
  const parsedDays = parseTaskDays(task)

  const data_points = dates.map(date => {
    const comp = completionMap.get(date)
    const scheduled = isTaskScheduledFast({ ...task, paused_at: task.paused_at ?? null }, parsedDays, date)
    return {
      date,
      scheduled,
      completed: !!comp,
      data_text: comp?.data_text ?? null,
      data_number: comp?.data_number ?? null,
    }
  })

  const scheduledDays = data_points.filter(d => d.scheduled)
  const completedDays = scheduledDays.filter(d => d.completed)
  const { current_streak, best_streak } = calcStreaks(scheduledDays)

  return ok({
    task: { ...task, frequency_days: task.frequency_days ? JSON.parse(task.frequency_days) : null },
    range,
    total_scheduled: scheduledDays.length,
    total_completed: completedDays.length,
    completion_rate: scheduledDays.length > 0
      ? Math.round((completedDays.length / scheduledDays.length) * 100)
      : 0,
    current_streak,
    best_streak,
    data_points,
  })
})

// ─── GET /overview ─────────────────────────────────────────────────────────────

app.get('/overview', async (c) => {
  const userId = c.get('userId')

  const range = (c.req.query('range') ?? 'month') as Range
  if (!['week', 'month', 'year', 'all'].includes(range)) return err('VALIDATION_ERROR', 'Invalid range')

  const db = getDB(c.env.DB)
  const { start, end } = getDateRange(range)

  const [tasks, completions] = await Promise.all([
    db.select().from(schema.tasks).where(eq(schema.tasks.user_id, userId)).all(),
    db.select().from(schema.completions)
      .where(and(
        eq(schema.completions.user_id, userId),
        gte(schema.completions.completed_date, start),
        lte(schema.completions.completed_date, end)
      ))
      .all(),
  ])

  const completionSet = new Set(completions.map(c => `${c.task_id}:${c.completed_date}`))
  const dates = dateRange(start, end)
  const parsedDaysMap = new Map(tasks.map(t => [t.id, parseTaskDays(t)]))

  // Daily rates
  const daily_rates = dates.map(date => {
    const scheduled = tasks.filter(t => isTaskScheduledFast(t, parsedDaysMap.get(t.id) ?? null, date))
    const done = scheduled.filter(t => completionSet.has(`${t.id}:${date}`))
    return {
      date,
      rate: scheduled.length > 0 ? Math.round((done.length / scheduled.length) * 100) : 0,
      completed: done.length,
      total: scheduled.length,
    }
  })

  // Streak for entire overview (all days where ≥1 task completed)
  const streakEntries = daily_rates.map(d => ({
    date: d.date,
    completed: d.total > 0 ? d.completed === d.total : false, // "perfect day" for streaks
  }))
  const { current_streak, best_streak } = calcStreaks(streakEntries)

  // Per-task breakdown
  const task_breakdown = tasks
    .filter(t => t.status !== 'archived')
    .map(t => {
      const pd = parsedDaysMap.get(t.id) ?? null
      const scheduled = dates.filter(d => isTaskScheduledFast(t, pd, d))
      const done = scheduled.filter(d => completionSet.has(`${t.id}:${d}`))
      return {
        task_id: t.id,
        task_name: t.name,
        task_color: t.color,
        completion_rate: scheduled.length > 0 ? Math.round((done.length / scheduled.length) * 100) : 0,
        total_completed: done.length,
      }
    })

  const total_completions = completions.length
  const activeDays = daily_rates.filter(d => d.total > 0)
  const avg_daily_rate = activeDays.length > 0
    ? Math.round(activeDays.reduce((s, d) => s + d.rate, 0) / activeDays.length)
    : 0

  return ok({
    range,
    daily_rates,
    current_streak,
    best_streak,
    total_completions,
    avg_daily_rate,
    task_breakdown,
  })
})

// ─── GET /heatmap ──────────────────────────────────────────────────────────────

app.get('/heatmap', async (c) => {
  const userId = c.get('userId')

  const yearParam = c.req.query('year')
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()
  if (isNaN(year) || year < 2020 || year > 2100) return err('VALIDATION_ERROR', 'Invalid year')

  const start = `${year}-01-01`
  const end = `${year}-12-31`
  const db = getDB(c.env.DB)

  const [tasks, completions] = await Promise.all([
    db.select().from(schema.tasks).where(eq(schema.tasks.user_id, userId)).all(),
    db.select().from(schema.completions)
      .where(and(
        eq(schema.completions.user_id, userId),
        gte(schema.completions.completed_date, start),
        lte(schema.completions.completed_date, end)
      ))
      .all(),
  ])

  const completionCountByDate = new Map<string, number>()
  for (const c of completions) {
    completionCountByDate.set(c.completed_date, (completionCountByDate.get(c.completed_date) ?? 0) + 1)
  }

  const parsedDaysMap = new Map(tasks.map(t => [t.id, parseTaskDays(t)]))
  const dates = dateRange(start, end)
  const today = new Date().toLocaleDateString('en-CA')

  const days = dates
    .filter(d => d <= today)
    .map(date => {
      const total = tasks.filter(t => isTaskScheduledFast(t, parsedDaysMap.get(t.id) ?? null, date)).length
      const count = completionCountByDate.get(date) ?? 0
      return { date, count, total }
    })

  return ok({ year, days })
})
