import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { applyMigrations, createUser, createTask, req } from '../helpers'

beforeAll(async () => {
  await applyMigrations(env.DB)
})

// ─── GET /api/tasks ────────────────────────────────────────────────────────────

describe('GET /api/tasks', () => {
  it('returns active tasks for the authenticated user', async () => {
    const user = await createUser(env.DB, env)
    await createTask(env.DB, user.id, { name: 'My Task' })
    const { status, body } = await req('GET', '/api/tasks', env, { token: user.token })
    expect(status).toBe(200)
    const tasks = (body as any).data.tasks
    expect(tasks.length).toBeGreaterThan(0)
    expect(tasks[0].name).toBe('My Task')
  })

  it('returns empty array when user has no tasks', async () => {
    const user = await createUser(env.DB, env)
    const { body } = await req('GET', '/api/tasks', env, { token: user.token })
    expect((body as any).data.tasks).toHaveLength(0)
  })

  it('filters by status=paused', async () => {
    const user = await createUser(env.DB, env)
    await createTask(env.DB, user.id, { status: 'active' })
    await createTask(env.DB, user.id, { status: 'paused' })
    const { body } = await req('GET', '/api/tasks?status=paused', env, { token: user.token })
    const tasks = (body as any).data.tasks
    expect(tasks.every((t: any) => t.status === 'paused')).toBe(true)
  })

  it('returns all tasks when status=all', async () => {
    const user = await createUser(env.DB, env)
    await createTask(env.DB, user.id, { status: 'active' })
    await createTask(env.DB, user.id, { status: 'archived' })
    const { body } = await req('GET', '/api/tasks?status=all', env, { token: user.token })
    expect((body as any).data.tasks.length).toBeGreaterThanOrEqual(2)
  })

  it('returns 401 without token', async () => {
    const { status } = await req('GET', '/api/tasks', env)
    expect(status).toBe(401)
  })

  it('does not return other users tasks', async () => {
    const userA = await createUser(env.DB, env)
    const userB = await createUser(env.DB, env)
    await createTask(env.DB, userA.id, { name: 'User A task' })
    const { body } = await req('GET', '/api/tasks', env, { token: userB.token })
    expect((body as any).data.tasks).toHaveLength(0)
  })
})

// ─── POST /api/tasks ───────────────────────────────────────────────────────────

describe('POST /api/tasks', () => {
  it('creates a daily task', async () => {
    const user = await createUser(env.DB, env)
    const { status, body } = await req('POST', '/api/tasks', env, {
      token: user.token,
      body: { name: 'Drink Water', frequency_type: 'daily' },
    })
    expect(status).toBe(201)
    const task = (body as any).data.task
    expect(task.name).toBe('Drink Water')
    expect(task.frequency_type).toBe('daily')
    expect(task.status).toBe('active')
  })

  it('creates a weekly task with frequency_days', async () => {
    const user = await createUser(env.DB, env)
    const { status, body } = await req('POST', '/api/tasks', env, {
      token: user.token,
      body: { name: 'Gym', frequency_type: 'weekly', frequency_days: [1, 3, 5] },
    })
    expect(status).toBe(201)
    const task = (body as any).data.task
    expect(task.frequency_type).toBe('weekly')
    expect(task.frequency_days).toEqual([1, 3, 5])
  })

  it('assigns a color automatically', async () => {
    const user = await createUser(env.DB, env)
    const { body } = await req('POST', '/api/tasks', env, {
      token: user.token,
      body: { name: 'Run' },
    })
    expect(typeof (body as any).data.task.color).toBe('string')
    expect((body as any).data.task.color).toMatch(/^#/)
  })

  it('strips HTML from task name', async () => {
    const user = await createUser(env.DB, env)
    const { body } = await req('POST', '/api/tasks', env, {
      token: user.token,
      body: { name: '<script>alert(1)</script>Run' },
    })
    expect((body as any).data.task.name).toBe('Run')
  })

  it('returns 400 for empty name', async () => {
    const user = await createUser(env.DB, env)
    const { status } = await req('POST', '/api/tasks', env, {
      token: user.token,
      body: { name: '' },
    })
    expect(status).toBe(400)
  })

  it('increments sort_order for subsequent tasks', async () => {
    const user = await createUser(env.DB, env)
    const r1 = await req('POST', '/api/tasks', env, {
      token: user.token, body: { name: 'First' },
    })
    const r2 = await req('POST', '/api/tasks', env, {
      token: user.token, body: { name: 'Second' },
    })
    const order1 = (r1.body as any).data.task.sort_order
    const order2 = (r2.body as any).data.task.sort_order
    expect(order2).toBeGreaterThan(order1)
  })
})

// ─── PATCH /api/tasks/:id ──────────────────────────────────────────────────────

describe('PATCH /api/tasks/:id', () => {
  it('updates task name', async () => {
    const user = await createUser(env.DB, env)
    const task = await createTask(env.DB, user.id)
    const { status, body } = await req('PATCH', `/api/tasks/${task.id}`, env, {
      token: user.token,
      body: { name: 'Updated Name' },
    })
    expect(status).toBe(200)
    expect((body as any).data.task.name).toBe('Updated Name')
  })

  it('returns 404 for a task belonging to another user', async () => {
    const userA = await createUser(env.DB, env)
    const userB = await createUser(env.DB, env)
    const task = await createTask(env.DB, userA.id)
    const { status } = await req('PATCH', `/api/tasks/${task.id}`, env, {
      token: userB.token,
      body: { name: 'Hacked' },
    })
    expect(status).toBe(404)
  })

  it('returns 404 for non-existent task', async () => {
    const user = await createUser(env.DB, env)
    const { status } = await req('PATCH', '/api/tasks/doesnotexist', env, {
      token: user.token,
      body: { name: 'X' },
    })
    expect(status).toBe(404)
  })
})

// ─── DELETE /api/tasks/:id ─────────────────────────────────────────────────────

describe('DELETE /api/tasks/:id', () => {
  it('archives a task (sets status=archived)', async () => {
    const user = await createUser(env.DB, env)
    const task = await createTask(env.DB, user.id)
    const { status } = await req('DELETE', `/api/tasks/${task.id}`, env, { token: user.token })
    expect(status).toBe(200)

    const row = await env.DB.prepare('SELECT status FROM tasks WHERE id = ?')
      .bind(task.id).first<{ status: string }>()
    expect(row!.status).toBe('archived')
  })

  it('returns 404 for another user task', async () => {
    const userA = await createUser(env.DB, env)
    const userB = await createUser(env.DB, env)
    const task = await createTask(env.DB, userA.id)
    const { status } = await req('DELETE', `/api/tasks/${task.id}`, env, { token: userB.token })
    expect(status).toBe(404)
  })
})

// ─── PATCH /api/tasks/:id/pause ────────────────────────────────────────────────

describe('PATCH /api/tasks/:id/pause', () => {
  it('sets status=paused and paused_at', async () => {
    const user = await createUser(env.DB, env)
    const task = await createTask(env.DB, user.id)
    const { status, body } = await req('PATCH', `/api/tasks/${task.id}/pause`, env, {
      token: user.token,
    })
    expect(status).toBe(200)
    expect((body as any).data.task.status).toBe('paused')
    expect((body as any).data.task.paused_at).not.toBeNull()
  })
})

// ─── PATCH /api/tasks/:id/resume ──────────────────────────────────────────────

describe('PATCH /api/tasks/:id/resume', () => {
  it('sets status=active and clears paused_at', async () => {
    const user = await createUser(env.DB, env)
    const task = await createTask(env.DB, user.id, { status: 'paused' })
    const { status, body } = await req('PATCH', `/api/tasks/${task.id}/resume`, env, {
      token: user.token,
    })
    expect(status).toBe(200)
    expect((body as any).data.task.status).toBe('active')
    expect((body as any).data.task.paused_at).toBeNull()
  })
})

// ─── PUT /api/tasks/reorder ────────────────────────────────────────────────────

describe('PUT /api/tasks/reorder', () => {
  it('updates sort_order for all provided IDs', async () => {
    const user = await createUser(env.DB, env)
    const t1 = await createTask(env.DB, user.id)
    const t2 = await createTask(env.DB, user.id)
    const t3 = await createTask(env.DB, user.id)

    const { status } = await req('PUT', '/api/tasks/reorder', env, {
      token: user.token,
      body: { task_ids: [t3.id, t1.id, t2.id] },
    })
    expect(status).toBe(200)

    const rows = await env.DB.prepare(
      'SELECT id, sort_order FROM tasks WHERE id IN (?, ?, ?) ORDER BY sort_order'
    ).bind(t1.id, t2.id, t3.id).all<{ id: string; sort_order: number }>()

    expect(rows.results[0].id).toBe(t3.id)
    expect(rows.results[1].id).toBe(t1.id)
    expect(rows.results[2].id).toBe(t2.id)
  })

  it('returns 404 if any task ID belongs to another user', async () => {
    const userA = await createUser(env.DB, env)
    const userB = await createUser(env.DB, env)
    const taskA = await createTask(env.DB, userA.id)
    const taskB = await createTask(env.DB, userB.id)

    const { status } = await req('PUT', '/api/tasks/reorder', env, {
      token: userA.token,
      body: { task_ids: [taskA.id, taskB.id] },
    })
    expect(status).toBe(404)
  })
})
