import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { applyMigrations, createUser, createTask, req } from '../helpers'
import type { Env } from '../../functions/lib/env'

const _env = env as unknown as Env

beforeAll(async () => {
  await applyMigrations(_env.DB)
})

// ─── POST /api/timers/start ────────────────────────────────────────────────────

describe('POST /api/timers/start', () => {
  it('creates active timer for stopwatch task', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })

    const { status, body } = await req('POST', '/api/timers/start', _env, {
      token: user.token,
      body: { task_id: task.id },
    })
    expect(status).toBe(201)
    expect((body.data as any).timer.task_id).toBe(task.id)
    expect((body.data as any).timer.started_at).toBeTruthy()
  })

  it('creates active timer for countdown task', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'countdown', timer_target_seconds: 60 })

    const { status } = await req('POST', '/api/timers/start', _env, {
      token: user.token,
      body: { task_id: task.id },
    })
    expect(status).toBe(201)
  })

  it('returns 409 if timer already running', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })

    await req('POST', '/api/timers/start', _env, { token: user.token, body: { task_id: task.id } })
    const { status, body } = await req('POST', '/api/timers/start', _env, {
      token: user.token,
      body: { task_id: task.id },
    })
    expect(status).toBe(409)
    expect((body.error as any).code).toBe('TIMER_ALREADY_RUNNING')
  })

  it('returns 400 for binary task', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'binary' })

    const { status, body } = await req('POST', '/api/timers/start', _env, {
      token: user.token,
      body: { task_id: task.id },
    })
    expect(status).toBe(400)
    expect((body.error as any).code).toBe('BINARY_TASK')
  })

  it('returns 404 for task owned by another user (IDOR)', async () => {
    const owner = await createUser(_env.DB, _env)
    const attacker = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, owner.id, { tracking_mode: 'stopwatch' })

    const { status } = await req('POST', '/api/timers/start', _env, {
      token: attacker.token,
      body: { task_id: task.id },
    })
    expect(status).toBe(404)
  })

  it('returns 400 for paused task', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch', status: 'paused' })

    const { status, body } = await req('POST', '/api/timers/start', _env, {
      token: user.token,
      body: { task_id: task.id },
    })
    expect(status).toBe(400)
    expect((body.error as any).code).toBe('TASK_NOT_ACTIVE')
  })
})

// ─── POST /api/timers/stop ─────────────────────────────────────────────────────

describe('POST /api/timers/stop', () => {
  it('stops timer and creates completion with duration_seconds', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })

    await req('POST', '/api/timers/start', _env, { token: user.token, body: { task_id: task.id } })

    const { status, body } = await req('POST', '/api/timers/stop', _env, {
      token: user.token,
      body: { task_id: task.id },
    })
    expect(status).toBe(200)
    const completion = (body.data as any).completion
    expect(completion.duration_seconds).toBeGreaterThanOrEqual(0)
    expect(completion.completed_date).toBeTruthy()
  })

  it('accumulates duration on second stop', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })

    // First session
    await req('POST', '/api/timers/start', _env, { token: user.token, body: { task_id: task.id } })
    const { body: body1 } = await req('POST', '/api/timers/stop', _env, { token: user.token, body: { task_id: task.id } })
    const first = (body1.data as any).completion.duration_seconds

    // Second session
    await req('POST', '/api/timers/start', _env, { token: user.token, body: { task_id: task.id } })
    const { body: body2 } = await req('POST', '/api/timers/stop', _env, { token: user.token, body: { task_id: task.id } })
    const second = (body2.data as any).completion.duration_seconds

    expect(second).toBeGreaterThanOrEqual(first)
  })

  it('returns 404 if no active timer', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })

    const { status } = await req('POST', '/api/timers/stop', _env, {
      token: user.token,
      body: { task_id: task.id },
    })
    expect(status).toBe(404)
  })
})

// ─── GET /api/timers/active ────────────────────────────────────────────────────

describe('GET /api/timers/active', () => {
  it('returns active timers for user only', async () => {
    const user1 = await createUser(_env.DB, _env)
    const user2 = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user1.id, { tracking_mode: 'stopwatch' })

    await req('POST', '/api/timers/start', _env, { token: user1.token, body: { task_id: task.id } })

    const { status, body } = await req('GET', '/api/timers/active', _env, { token: user1.token })
    expect(status).toBe(200)
    expect((body.data as any).timers).toHaveLength(1)
    expect((body.data as any).timers[0].task_id).toBe(task.id)

    // user2 sees no timers
    const { body: body2 } = await req('GET', '/api/timers/active', _env, { token: user2.token })
    expect((body2.data as any).timers).toHaveLength(0)
  })

  it('returns task metadata with timer', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'countdown', timer_target_seconds: 300 })

    await req('POST', '/api/timers/start', _env, { token: user.token, body: { task_id: task.id } })

    const { body } = await req('GET', '/api/timers/active', _env, { token: user.token })
    const timer = (body.data as any).timers[0]
    expect(timer.tracking_mode).toBe('countdown')
    expect(timer.timer_target_seconds).toBe(300)
    expect(timer.task_name).toBeTruthy()
  })
})

// ─── POST /api/timers/discard ──────────────────────────────────────────────────

describe('POST /api/timers/discard', () => {
  it('deletes active timer without creating completion', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })

    await req('POST', '/api/timers/start', _env, { token: user.token, body: { task_id: task.id } })

    const { status, body } = await req('POST', '/api/timers/discard', _env, {
      token: user.token,
      body: { task_id: task.id },
    })
    expect(status).toBe(200)

    // Timer gone
    const { body: activeBody } = await req('GET', '/api/timers/active', _env, { token: user.token })
    expect((activeBody.data as any).timers).toHaveLength(0)

    // No completion created
    const today = new Date().toLocaleDateString('en-CA')
    const { body: compBody } = await req('GET', `/api/completions?date=${today}`, _env, { token: user.token })
    const completions = (compBody.data as any).completions as any[]
    expect(completions.filter((c: any) => c.task_id === task.id)).toHaveLength(0)
  })

  it('returns 404 if no active timer', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })

    const { status } = await req('POST', '/api/timers/discard', _env, {
      token: user.token,
      body: { task_id: task.id },
    })
    expect(status).toBe(404)
  })
})

// ─── Completions route: reject timed tasks ────────────────────────────────────

describe('POST /api/completions — timed task rejection', () => {
  it('returns 400 TIMED_TASK for stopwatch task', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })
    const today = new Date().toLocaleDateString('en-CA')

    const { status, body } = await req('POST', '/api/completions', _env, {
      token: user.token,
      body: { task_id: task.id, date: today },
    })
    expect(status).toBe(400)
    expect((body.error as any).code).toBe('TIMED_TASK')
  })

  it('returns 400 TIMED_TASK for countdown task', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'countdown', timer_target_seconds: 60 })
    const today = new Date().toLocaleDateString('en-CA')

    const { status, body } = await req('POST', '/api/completions', _env, {
      token: user.token,
      body: { task_id: task.id, date: today },
    })
    expect(status).toBe(400)
    expect((body.error as any).code).toBe('TIMED_TASK')
  })

  it('still accepts binary tasks normally', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'binary' })
    const today = new Date().toLocaleDateString('en-CA')

    const { status } = await req('POST', '/api/completions', _env, {
      token: user.token,
      body: { task_id: task.id, date: today },
    })
    expect(status).toBe(201)
  })
})

// ─── POST /api/tasks — tracking mode ──────────────────────────────────────────

describe('POST /api/tasks — tracking mode', () => {
  it('creates stopwatch task with tracking_mode persisted', async () => {
    const user = await createUser(_env.DB, _env)

    const { status, body } = await req('POST', '/api/tasks', _env, {
      token: user.token,
      body: { name: 'Workout', tracking_mode: 'stopwatch' },
    })
    expect(status).toBe(201)
    expect((body.data as any).task.tracking_mode).toBe('stopwatch')
    expect((body.data as any).task.timer_target_seconds).toBeNull()
  })

  it('creates countdown task with timer_target_seconds', async () => {
    const user = await createUser(_env.DB, _env)

    const { status, body } = await req('POST', '/api/tasks', _env, {
      token: user.token,
      body: { name: 'Meditation', tracking_mode: 'countdown', timer_target_seconds: 600 },
    })
    expect(status).toBe(201)
    expect((body.data as any).task.tracking_mode).toBe('countdown')
    expect((body.data as any).task.timer_target_seconds).toBe(600)
  })

  it('returns 400 for countdown without timer_target_seconds', async () => {
    const user = await createUser(_env.DB, _env)

    const { status } = await req('POST', '/api/tasks', _env, {
      token: user.token,
      body: { name: 'Meditation', tracking_mode: 'countdown' },
    })
    expect(status).toBe(400)
  })

  it('PATCH does not change tracking_mode', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })

    const { status, body } = await req('PATCH', `/api/tasks/${task.id}`, _env, {
      token: user.token,
      body: { name: 'Updated Name', tracking_mode: 'binary' },
    })
    expect(status).toBe(200)
    // tracking_mode is ignored in PATCH — should still be stopwatch
    expect((body.data as any).task.tracking_mode).toBe('stopwatch')
  })
})

// ─── GET /api/analytics/calendar ──────────────────────────────────────────────

describe('GET /api/analytics/calendar', () => {
  it('returns calendar data for requested month', async () => {
    const user = await createUser(_env.DB, _env)
    const today = new Date().toLocaleDateString('en-CA')
    const month = today.slice(0, 7)

    const { status, body } = await req('GET', `/api/analytics/calendar?month=${month}`, _env, {
      token: user.token,
    })
    expect(status).toBe(200)
    expect((body.data as any).month).toBe(month)
    expect(Array.isArray((body.data as any).days)).toBe(true)
  })

  it('only includes past/present days', async () => {
    const user = await createUser(_env.DB, _env)
    const today = new Date().toLocaleDateString('en-CA')
    const month = today.slice(0, 7)

    const { body } = await req('GET', `/api/analytics/calendar?month=${month}`, _env, {
      token: user.token,
    })
    const days: any[] = (body.data as any).days
    for (const day of days) {
      expect(day.date <= today).toBe(true)
    }
  })

  it('calculates ratio based on completions', async () => {
    const user = await createUser(_env.DB, _env)
    const today = new Date().toLocaleDateString('en-CA')
    const month = today.slice(0, 7)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'binary' })

    // Complete the task today
    await req('POST', '/api/completions', _env, {
      token: user.token,
      body: { task_id: task.id, date: today },
    })

    const { body } = await req('GET', `/api/analytics/calendar?month=${month}`, _env, {
      token: user.token,
    })
    const days: any[] = (body.data as any).days
    const todayEntry = days.find(d => d.date === today)
    expect(todayEntry).toBeTruthy()
    expect(todayEntry.completed).toBeGreaterThanOrEqual(1)
    expect(todayEntry.ratio).toBeGreaterThan(0)
  })

  it('returns 400 for invalid month format', async () => {
    const user = await createUser(_env.DB, _env)

    const { status } = await req('GET', '/api/analytics/calendar?month=invalid', _env, {
      token: user.token,
    })
    expect(status).toBe(400)
  })
})
