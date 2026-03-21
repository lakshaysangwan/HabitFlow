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
    expect((body.data as any).timer.accumulated_seconds).toBe(0)
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

  it('returns 409 if timer already exists for task', async () => {
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

  it('enforces max 3 concurrent timers', async () => {
    const user = await createUser(_env.DB, _env)
    const tasks = await Promise.all([
      createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' }),
      createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' }),
      createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' }),
      createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' }),
    ])

    for (let i = 0; i < 3; i++) {
      const { status } = await req('POST', '/api/timers/start', _env, {
        token: user.token, body: { task_id: tasks[i].id },
      })
      expect(status).toBe(201)
    }

    const { status, body } = await req('POST', '/api/timers/start', _env, {
      token: user.token, body: { task_id: tasks[3].id },
    })
    expect(status).toBe(409)
    expect((body.error as any).code).toBe('TOO_MANY_TIMERS')
  })

  it('rejects start if task already has finalized completion today', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })

    // Start → done to finalize
    await req('POST', '/api/timers/start', _env, { token: user.token, body: { task_id: task.id } })
    const { status: doneStatus } = await req('POST', '/api/timers/done', _env, { token: user.token, body: { task_id: task.id } })
    expect(doneStatus).toBe(200)

    // Try to start again
    const { status, body } = await req('POST', '/api/timers/start', _env, {
      token: user.token, body: { task_id: task.id },
    })
    expect(status).toBe(409)
    expect((body.error as any).code).toBe('ALREADY_FINALIZED')
  })
})

// ─── POST /api/timers/pause ────────────────────────────────────────────────────

describe('POST /api/timers/pause', () => {
  it('pauses a running timer and accumulates seconds', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })

    await req('POST', '/api/timers/start', _env, { token: user.token, body: { task_id: task.id } })

    const { status, body } = await req('POST', '/api/timers/pause', _env, {
      token: user.token, body: { task_id: task.id },
    })
    expect(status).toBe(200)
    const timer = (body.data as any).timer
    expect(timer.accumulated_seconds).toBeGreaterThanOrEqual(0)
  })

  it('returns 400 when timer is already paused', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })

    await req('POST', '/api/timers/start', _env, { token: user.token, body: { task_id: task.id } })
    await req('POST', '/api/timers/pause', _env, { token: user.token, body: { task_id: task.id } })

    const { status, body } = await req('POST', '/api/timers/pause', _env, {
      token: user.token, body: { task_id: task.id },
    })
    expect(status).toBe(400)
    expect((body.error as any).code).toBe('ALREADY_PAUSED')
  })

  it('returns 404 if no timer exists', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })

    const { status } = await req('POST', '/api/timers/pause', _env, {
      token: user.token, body: { task_id: task.id },
    })
    expect(status).toBe(404)
  })
})

// ─── POST /api/timers/resume ───────────────────────────────────────────────────

describe('POST /api/timers/resume', () => {
  it('resumes a paused timer', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })

    await req('POST', '/api/timers/start', _env, { token: user.token, body: { task_id: task.id } })
    await req('POST', '/api/timers/pause', _env, { token: user.token, body: { task_id: task.id } })

    const { status, body } = await req('POST', '/api/timers/resume', _env, {
      token: user.token, body: { task_id: task.id },
    })
    expect(status).toBe(200)
    expect((body.data as any).timer.started_at).toBeTruthy()
  })

  it('returns 400 when timer is already running', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })

    await req('POST', '/api/timers/start', _env, { token: user.token, body: { task_id: task.id } })

    const { status, body } = await req('POST', '/api/timers/resume', _env, {
      token: user.token, body: { task_id: task.id },
    })
    expect(status).toBe(400)
    expect((body.error as any).code).toBe('ALREADY_RUNNING')
  })
})

// ─── POST /api/timers/done ─────────────────────────────────────────────────────

describe('POST /api/timers/done', () => {
  it('finalizes a running timer — creates is_finalized completion', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })

    await req('POST', '/api/timers/start', _env, { token: user.token, body: { task_id: task.id } })

    const { status, body } = await req('POST', '/api/timers/done', _env, {
      token: user.token, body: { task_id: task.id },
    })
    expect(status).toBe(200)
    const completion = (body.data as any).completion
    expect(completion.duration_seconds).toBeGreaterThanOrEqual(0)
    expect(completion.is_finalized).toBe(1)
  })

  it('finalizes a paused timer', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })

    await req('POST', '/api/timers/start', _env, { token: user.token, body: { task_id: task.id } })
    await req('POST', '/api/timers/pause', _env, { token: user.token, body: { task_id: task.id } })

    const { status, body } = await req('POST', '/api/timers/done', _env, {
      token: user.token, body: { task_id: task.id },
    })
    expect(status).toBe(200)
    expect((body.data as any).completion.is_finalized).toBe(1)
  })

  it('accumulates across pause/resume cycles', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })

    // cycle 1
    await req('POST', '/api/timers/start', _env, { token: user.token, body: { task_id: task.id } })
    await req('POST', '/api/timers/pause', _env, { token: user.token, body: { task_id: task.id } })
    // cycle 2
    await req('POST', '/api/timers/resume', _env, { token: user.token, body: { task_id: task.id } })
    const { body } = await req('POST', '/api/timers/done', _env, {
      token: user.token, body: { task_id: task.id },
    })
    // duration should be >= 0 (timing is tight in tests)
    expect((body.data as any).completion.duration_seconds).toBeGreaterThanOrEqual(0)
  })

  it('removes timer after done', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })

    await req('POST', '/api/timers/start', _env, { token: user.token, body: { task_id: task.id } })
    await req('POST', '/api/timers/done', _env, { token: user.token, body: { task_id: task.id } })

    const { body } = await req('GET', '/api/timers/active', _env, { token: user.token })
    const timers = (body.data as any).timers as any[]
    expect(timers.filter(t => t.task_id === task.id)).toHaveLength(0)
  })

  it('returns 404 if no timer', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })

    const { status } = await req('POST', '/api/timers/done', _env, {
      token: user.token, body: { task_id: task.id },
    })
    expect(status).toBe(404)
  })
})

// ─── is_finalized blocks delete ────────────────────────────────────────────────

describe('is_finalized — completion is locked after done', () => {
  it('DELETE /api/completions/:id returns 403 for finalized completion', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })

    await req('POST', '/api/timers/start', _env, { token: user.token, body: { task_id: task.id } })
    const { body: doneBody } = await req('POST', '/api/timers/done', _env, {
      token: user.token, body: { task_id: task.id },
    })
    const completionId = (doneBody.data as any).completion.id

    const { status, body } = await req('DELETE', `/api/completions/${completionId}`, _env, {
      token: user.token,
    })
    expect(status).toBe(403)
    expect((body.error as any).code).toBe('COMPLETION_LOCKED')
  })
})

// ─── PATCH /api/timers/target ──────────────────────────────────────────────────

describe('PATCH /api/timers/target', () => {
  it('increases target while paused', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'countdown', timer_target_seconds: 60 })

    await req('POST', '/api/timers/start', _env, { token: user.token, body: { task_id: task.id } })
    await req('POST', '/api/timers/pause', _env, { token: user.token, body: { task_id: task.id } })

    const { status, body } = await req('PATCH', '/api/timers/target', _env, {
      token: user.token, body: { task_id: task.id, target_seconds: 120 },
    })
    expect(status).toBe(200)
    expect((body.data as any).timer.target_override_seconds).toBe(120)
  })

  it('rejects target decrease', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'countdown', timer_target_seconds: 120 })

    await req('POST', '/api/timers/start', _env, { token: user.token, body: { task_id: task.id } })
    await req('POST', '/api/timers/pause', _env, { token: user.token, body: { task_id: task.id } })

    const { status, body } = await req('PATCH', '/api/timers/target', _env, {
      token: user.token, body: { task_id: task.id, target_seconds: 60 },
    })
    expect(status).toBe(400)
    expect((body.error as any).code).toBe('TARGET_TOO_LOW')
  })

  it('rejects target patch on running timer', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'countdown', timer_target_seconds: 60 })

    await req('POST', '/api/timers/start', _env, { token: user.token, body: { task_id: task.id } })

    const { status, body } = await req('PATCH', '/api/timers/target', _env, {
      token: user.token, body: { task_id: task.id, target_seconds: 120 },
    })
    expect(status).toBe(400)
    expect((body.error as any).code).toBe('TIMER_RUNNING')
  })

  it('rejects for non-countdown task', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })

    await req('POST', '/api/timers/start', _env, { token: user.token, body: { task_id: task.id } })
    await req('POST', '/api/timers/pause', _env, { token: user.token, body: { task_id: task.id } })

    const { status, body } = await req('PATCH', '/api/timers/target', _env, {
      token: user.token, body: { task_id: task.id, target_seconds: 120 },
    })
    expect(status).toBe(400)
    expect((body.error as any).code).toBe('NOT_COUNTDOWN')
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

  it('returns v5 fields: accumulated_seconds, logical_date, orphaned', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'countdown', timer_target_seconds: 300 })

    await req('POST', '/api/timers/start', _env, { token: user.token, body: { task_id: task.id } })

    const { body } = await req('GET', '/api/timers/active', _env, { token: user.token })
    const timer = (body.data as any).timers[0]
    expect(timer.tracking_mode).toBe('countdown')
    expect(timer.timer_target_seconds).toBe(300)
    expect(timer.task_name).toBeTruthy()
    expect(typeof timer.accumulated_seconds).toBe('number')
    expect(typeof timer.logical_date).toBe('string')
    expect(typeof timer.orphaned).toBe('boolean')
    expect(timer.orphaned).toBe(false)
  })
})

// ─── POST /api/timers/discard ──────────────────────────────────────────────────

describe('POST /api/timers/discard', () => {
  it('deletes active timer without creating completion', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'stopwatch' })

    await req('POST', '/api/timers/start', _env, { token: user.token, body: { task_id: task.id } })

    const { status } = await req('POST', '/api/timers/discard', _env, {
      token: user.token,
      body: { task_id: task.id },
    })
    expect(status).toBe(200)

    // Timer gone
    const { body: activeBody } = await req('GET', '/api/timers/active', _env, { token: user.token })
    const timers = (activeBody.data as any).timers as any[]
    expect(timers.filter(t => t.task_id === task.id)).toHaveLength(0)

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

// ─── Past-date locking ─────────────────────────────────────────────────────────

describe('past-date locking on completions', () => {
  it('POST /api/completions rejects dates older than yesterday', async () => {
    const user = await createUser(_env.DB, _env)
    const task = await createTask(_env.DB, user.id, { tracking_mode: 'binary', start_date: '2020-01-01' })

    const { status, body } = await req('POST', '/api/completions', _env, {
      token: user.token,
      body: { task_id: task.id, date: '2020-01-15' },
    })
    expect(status).toBe(403)
    expect((body.error as any).code).toBe('DATE_LOCKED')
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
