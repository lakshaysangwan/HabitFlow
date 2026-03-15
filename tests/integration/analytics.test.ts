import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { applyMigrations, createUser, createTask, createCompletion, req } from '../helpers'

beforeAll(async () => {
  await applyMigrations(env.DB)
})

const TODAY = new Date().toLocaleDateString('en-CA')
const YESTERDAY = (() => {
  const d = new Date(); d.setDate(d.getDate() - 1); return d.toLocaleDateString('en-CA')
})()

// ─── GET /api/analytics/daily ──────────────────────────────────────────────────

describe('GET /api/analytics/daily', () => {
  it('returns task items with completion status', async () => {
    const user = await createUser(env.DB, env)
    const task = await createTask(env.DB, user.id)
    await createCompletion(env.DB, task.id, user.id, TODAY)

    const { status, body } = await req('GET', `/api/analytics/daily?date=${TODAY}`, env, {
      token: user.token,
    })
    expect(status).toBe(200)
    const data = (body as any).data
    expect(data.date).toBe(TODAY)
    expect(data.total).toBeGreaterThan(0)
    expect(data.completed).toBeGreaterThan(0)
    expect(data.rate).toBe(100)
    const taskItem = data.tasks.find((t: any) => t.task_id === task.id)
    expect(taskItem.completed).toBe(true)
  })

  it('defaults to today when date param is omitted', async () => {
    const user = await createUser(env.DB, env)
    const { status, body } = await req('GET', '/api/analytics/daily', env, { token: user.token })
    expect(status).toBe(200)
    expect((body as any).data.date).toBe(TODAY)
  })

  it('returns 400 for invalid date', async () => {
    const user = await createUser(env.DB, env)
    const { status } = await req('GET', '/api/analytics/daily?date=invalid', env, { token: user.token })
    expect(status).toBe(400)
  })

  it('returns rate=0 when no tasks are scheduled', async () => {
    const user = await createUser(env.DB, env)
    const { body } = await req('GET', `/api/analytics/daily?date=${TODAY}`, env, { token: user.token })
    expect((body as any).data.rate).toBe(0)
    expect((body as any).data.total).toBe(0)
  })
})

// ─── GET /api/analytics/task/:id ──────────────────────────────────────────────

describe('GET /api/analytics/task/:id', () => {
  it('returns task stats including data_points', async () => {
    const user = await createUser(env.DB, env)
    const task = await createTask(env.DB, user.id)
    await createCompletion(env.DB, task.id, user.id, TODAY)

    const { status, body } = await req(`GET`, `/api/analytics/task/${task.id}?range=week`, env, {
      token: user.token,
    })
    expect(status).toBe(200)
    const data = (body as any).data
    expect(data.task.id).toBe(task.id)
    expect(Array.isArray(data.data_points)).toBe(true)
    expect(data.total_scheduled).toBeGreaterThan(0)
    expect(data.total_completed).toBeGreaterThan(0)
    expect(data.completion_rate).toBe(100)
  })

  it('returns 404 for task belonging to another user', async () => {
    const userA = await createUser(env.DB, env)
    const userB = await createUser(env.DB, env)
    const task = await createTask(env.DB, userA.id)
    const { status } = await req(`GET`, `/api/analytics/task/${task.id}`, env, { token: userB.token })
    expect(status).toBe(404)
  })

  it('returns 400 for invalid range', async () => {
    const user = await createUser(env.DB, env)
    const task = await createTask(env.DB, user.id)
    const { status } = await req(`GET`, `/api/analytics/task/${task.id}?range=decade`, env, {
      token: user.token,
    })
    expect(status).toBe(400)
  })

  it('accepts all valid range values', async () => {
    const user = await createUser(env.DB, env)
    const task = await createTask(env.DB, user.id)
    for (const range of ['week', 'month', 'year', 'all']) {
      const { status } = await req(`GET`, `/api/analytics/task/${task.id}?range=${range}`, env, {
        token: user.token,
      })
      expect(status).toBe(200)
    }
  })

  it('data_points include scheduled flag', async () => {
    const user = await createUser(env.DB, env)
    const task = await createTask(env.DB, user.id)
    const { body } = await req(`GET`, `/api/analytics/task/${task.id}?range=week`, env, {
      token: user.token,
    })
    const points = (body as any).data.data_points
    expect(points.length).toBeGreaterThan(0)
    expect(typeof points[0].scheduled).toBe('boolean')
  })
})

// ─── GET /api/analytics/overview ──────────────────────────────────────────────

describe('GET /api/analytics/overview', () => {
  it('returns daily_rates, streaks, task_breakdown', async () => {
    const user = await createUser(env.DB, env)
    await createTask(env.DB, user.id)

    const { status, body } = await req('GET', '/api/analytics/overview?range=week', env, {
      token: user.token,
    })
    expect(status).toBe(200)
    const data = (body as any).data
    expect(Array.isArray(data.daily_rates)).toBe(true)
    expect(data.daily_rates.length).toBe(7) // week = 7 days
    expect(typeof data.current_streak).toBe('number')
    expect(typeof data.best_streak).toBe('number')
    expect(Array.isArray(data.task_breakdown)).toBe(true)
    expect(typeof data.total_completions).toBe('number')
    expect(typeof data.avg_daily_rate).toBe('number')
  })

  it('accepts all valid range values', async () => {
    const user = await createUser(env.DB, env)
    for (const range of ['week', 'month', 'year', 'all']) {
      const { status } = await req('GET', `/api/analytics/overview?range=${range}`, env, {
        token: user.token,
      })
      expect(status).toBe(200)
    }
  })

  it('returns 401 without token', async () => {
    const { status } = await req('GET', '/api/analytics/overview', env)
    expect(status).toBe(401)
  })
})

// ─── GET /api/analytics/heatmap ───────────────────────────────────────────────

describe('GET /api/analytics/heatmap', () => {
  it('returns days array for the requested year', async () => {
    const user = await createUser(env.DB, env)
    const year = new Date().getFullYear()
    const { status, body } = await req(`GET`, `/api/analytics/heatmap?year=${year}`, env, {
      token: user.token,
    })
    expect(status).toBe(200)
    const data = (body as any).data
    expect(data.year).toBe(year)
    expect(Array.isArray(data.days)).toBe(true)
    expect(data.days.length).toBeGreaterThan(0)
  })

  it('defaults to current year when year param is omitted', async () => {
    const user = await createUser(env.DB, env)
    const { status, body } = await req('GET', '/api/analytics/heatmap', env, { token: user.token })
    expect(status).toBe(200)
    expect((body as any).data.year).toBe(new Date().getFullYear())
  })

  it('returns 400 for year before 2020', async () => {
    const user = await createUser(env.DB, env)
    const { status } = await req('GET', '/api/analytics/heatmap?year=2019', env, { token: user.token })
    expect(status).toBe(400)
  })

  it('returns 400 for year after 2100', async () => {
    const user = await createUser(env.DB, env)
    const { status } = await req('GET', '/api/analytics/heatmap?year=2101', env, { token: user.token })
    expect(status).toBe(400)
  })

  it('only includes past dates (no future dates in days)', async () => {
    const user = await createUser(env.DB, env)
    const year = new Date().getFullYear()
    const { body } = await req(`GET`, `/api/analytics/heatmap?year=${year}`, env, { token: user.token })
    const today = TODAY
    const futureDays = (body as any).data.days.filter((d: any) => d.date > today)
    expect(futureDays).toHaveLength(0)
  })
})
