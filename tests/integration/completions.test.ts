import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { applyMigrations, createUser, createTask, createCompletion, req } from '../helpers'

beforeAll(async () => {
  await applyMigrations(env.DB)
})

const TODAY = new Date().toLocaleDateString('en-CA')
const YESTERDAY = (() => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toLocaleDateString('en-CA')
})()
const TOMORROW = (() => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA')
})()

// ─── GET /api/completions ──────────────────────────────────────────────────────

describe('GET /api/completions', () => {
  it('returns completions for the given date with task info', async () => {
    const user = await createUser(env.DB, env)
    const task = await createTask(env.DB, user.id)
    await createCompletion(env.DB, task.id, user.id, TODAY)

    const { status, body } = await req(`GET`, `/api/completions?date=${TODAY}`, env, {
      token: user.token,
    })
    expect(status).toBe(200)
    const completions = (body as any).data.completions
    expect(completions.length).toBeGreaterThan(0)
    expect(completions[0].task_id).toBe(task.id)
    expect(completions[0].task).not.toBeNull()
  })

  it('returns empty array when no completions on date', async () => {
    const user = await createUser(env.DB, env)
    const { body } = await req(`GET`, `/api/completions?date=${TODAY}`, env, { token: user.token })
    expect((body as any).data.completions).toHaveLength(0)
  })

  it('returns 400 when date param is missing', async () => {
    const user = await createUser(env.DB, env)
    const { status } = await req('GET', '/api/completions', env, { token: user.token })
    expect(status).toBe(400)
  })

  it('returns 400 for invalid date format', async () => {
    const user = await createUser(env.DB, env)
    const { status } = await req('GET', '/api/completions?date=not-a-date', env, { token: user.token })
    expect(status).toBe(400)
  })

  it('does not return other users completions', async () => {
    const userA = await createUser(env.DB, env)
    const userB = await createUser(env.DB, env)
    const task = await createTask(env.DB, userA.id)
    await createCompletion(env.DB, task.id, userA.id, TODAY)

    const { body } = await req(`GET`, `/api/completions?date=${TODAY}`, env, { token: userB.token })
    expect((body as any).data.completions).toHaveLength(0)
  })
})

// ─── POST /api/completions ─────────────────────────────────────────────────────

describe('POST /api/completions', () => {
  it('creates a completion for today', async () => {
    const user = await createUser(env.DB, env)
    const task = await createTask(env.DB, user.id)
    const { status, body } = await req('POST', '/api/completions', env, {
      token: user.token,
      body: { task_id: task.id, date: TODAY },
    })
    expect(status).toBe(201)
    expect((body as any).data.completion.task_id).toBe(task.id)
  })

  it('creates a completion with data_text and data_number', async () => {
    const user = await createUser(env.DB, env)
    const task = await createTask(env.DB, user.id)
    const { status, body } = await req('POST', '/api/completions', env, {
      token: user.token,
      body: { task_id: task.id, date: TODAY, data_text: 'felt great', data_number: 42 },
    })
    expect(status).toBe(201)
    expect((body as any).data.completion.data_text).toBe('felt great')
    expect((body as any).data.completion.data_number).toBe(42)
  })

  it('returns 400 for a future date', async () => {
    const user = await createUser(env.DB, env)
    const task = await createTask(env.DB, user.id)
    const { status, body } = await req('POST', '/api/completions', env, {
      token: user.token,
      body: { task_id: task.id, date: TOMORROW },
    })
    expect(status).toBe(400)
    expect((body as any).error.code).toBe('FUTURE_DATE')
  })

  it('returns 400 for a date before task start_date', async () => {
    const user = await createUser(env.DB, env)
    const task = await createTask(env.DB, user.id, { start_date: TODAY })
    const { status, body } = await req('POST', '/api/completions', env, {
      token: user.token,
      body: { task_id: task.id, date: YESTERDAY },
    })
    expect(status).toBe(400)
    expect((body as any).error.code).toBe('BEFORE_START')
  })

  it('returns 400 for archived task', async () => {
    const user = await createUser(env.DB, env)
    const task = await createTask(env.DB, user.id, { status: 'archived' })
    const { status, body } = await req('POST', '/api/completions', env, {
      token: user.token,
      body: { task_id: task.id, date: TODAY },
    })
    expect(status).toBe(400)
    expect((body as any).error.code).toBe('TASK_ARCHIVED')
  })

  it('returns 409 on duplicate completion for same task+date', async () => {
    const user = await createUser(env.DB, env)
    const task = await createTask(env.DB, user.id)
    await req('POST', '/api/completions', env, {
      token: user.token,
      body: { task_id: task.id, date: TODAY },
    })
    const { status, body } = await req('POST', '/api/completions', env, {
      token: user.token,
      body: { task_id: task.id, date: TODAY },
    })
    expect(status).toBe(409)
    expect((body as any).error.code).toBe('ALREADY_COMPLETED')
  })

  it('returns 404 for task belonging to another user', async () => {
    const userA = await createUser(env.DB, env)
    const userB = await createUser(env.DB, env)
    const task = await createTask(env.DB, userA.id)
    const { status } = await req('POST', '/api/completions', env, {
      token: userB.token,
      body: { task_id: task.id, date: TODAY },
    })
    expect(status).toBe(404)
  })

  it('returns 400 for wrong day-of-week on weekly task', async () => {
    const user = await createUser(env.DB, env)
    // Task scheduled Mon/Tue (1, 2). Find a day that is NOT Mon or Tue.
    const d = new Date(TODAY + 'T12:00:00')
    const dow = d.getDay() === 0 ? 7 : d.getDay()
    const allowedDays = [1, 2].includes(dow) ? [3, 4] : [1, 2]
    const task = await createTask(env.DB, user.id, { frequency_type: 'weekly', frequency_days: allowedDays })

    const { status, body } = await req('POST', '/api/completions', env, {
      token: user.token,
      body: { task_id: task.id, date: TODAY },
    })
    // If today IS one of those days, it would succeed — skip assertion
    if (allowedDays.includes(dow)) return
    expect(status).toBe(400)
    expect((body as any).error.code).toBe('WRONG_DAY')
  })
})

// ─── DELETE /api/completions/:id ───────────────────────────────────────────────

describe('DELETE /api/completions/:id', () => {
  it('deletes own completion', async () => {
    const user = await createUser(env.DB, env)
    const task = await createTask(env.DB, user.id)
    const completion = await createCompletion(env.DB, task.id, user.id, TODAY)
    const { status } = await req('DELETE', `/api/completions/${completion.id}`, env, {
      token: user.token,
    })
    expect(status).toBe(200)

    const row = await env.DB.prepare('SELECT id FROM completions WHERE id = ?')
      .bind(completion.id).first()
    expect(row).toBeNull()
  })

  it('returns 404 for another user completion', async () => {
    const userA = await createUser(env.DB, env)
    const userB = await createUser(env.DB, env)
    const task = await createTask(env.DB, userA.id)
    const completion = await createCompletion(env.DB, task.id, userA.id, TODAY)
    const { status } = await req('DELETE', `/api/completions/${completion.id}`, env, {
      token: userB.token,
    })
    expect(status).toBe(404)
  })
})
