/**
 * IDOR (Insecure Direct Object Reference) tests.
 * Ensures User A cannot access or modify User B's resources.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { applyMigrations, createUser, createTask, createCompletion, req } from '../helpers'

beforeAll(async () => {
  await applyMigrations(env.DB)
})

const TODAY = new Date().toLocaleDateString('en-CA')

describe('IDOR — Tasks', () => {
  it('GET /tasks does not return other users tasks', async () => {
    const userA = await createUser(env.DB, env)
    const userB = await createUser(env.DB, env)
    await createTask(env.DB, userA.id, { name: 'Secret Task' })

    const { body } = await req('GET', '/api/tasks', env, { token: userB.token })
    expect((body as any).data.tasks).toHaveLength(0)
  })

  it('PATCH /tasks/:id with another users task ID returns 404', async () => {
    const userA = await createUser(env.DB, env)
    const userB = await createUser(env.DB, env)
    const task = await createTask(env.DB, userA.id)

    const { status } = await req('PATCH', `/api/tasks/${task.id}`, env, {
      token: userB.token,
      body: { name: 'Hacked' },
    })
    expect(status).toBe(404)
  })

  it('DELETE /tasks/:id with another users task ID returns 404', async () => {
    const userA = await createUser(env.DB, env)
    const userB = await createUser(env.DB, env)
    const task = await createTask(env.DB, userA.id)

    const { status } = await req('DELETE', `/api/tasks/${task.id}`, env, { token: userB.token })
    expect(status).toBe(404)
    // Confirm it was NOT archived
    const row = await env.DB.prepare('SELECT status FROM tasks WHERE id = ?')
      .bind(task.id).first<{ status: string }>()
    expect(row!.status).toBe('active')
  })

  it('PATCH /tasks/:id/pause with another users task ID returns 404', async () => {
    const userA = await createUser(env.DB, env)
    const userB = await createUser(env.DB, env)
    const task = await createTask(env.DB, userA.id)

    const { status } = await req('PATCH', `/api/tasks/${task.id}/pause`, env, { token: userB.token })
    expect(status).toBe(404)
  })

  it('PATCH /tasks/:id/resume with another users task ID returns 404', async () => {
    const userA = await createUser(env.DB, env)
    const userB = await createUser(env.DB, env)
    const task = await createTask(env.DB, userA.id, { status: 'paused' })

    const { status } = await req('PATCH', `/api/tasks/${task.id}/resume`, env, { token: userB.token })
    expect(status).toBe(404)
  })

  it('PUT /tasks/reorder with mixed-user IDs returns 404', async () => {
    const userA = await createUser(env.DB, env)
    const userB = await createUser(env.DB, env)
    const taskA = await createTask(env.DB, userA.id)
    const taskB = await createTask(env.DB, userB.id)

    // User A tries to reorder including User B's task
    const { status } = await req('PUT', '/api/tasks/reorder', env, {
      token: userA.token,
      body: { task_ids: [taskA.id, taskB.id] },
    })
    expect(status).toBe(404)
    // Ensure original order was not changed
    const rowA = await env.DB.prepare('SELECT sort_order FROM tasks WHERE id = ?')
      .bind(taskA.id).first<{ sort_order: number }>()
    expect(rowA!.sort_order).toBe(0)
  })
})

describe('IDOR — Completions', () => {
  it('POST /completions with another users task_id returns 404', async () => {
    const userA = await createUser(env.DB, env)
    const userB = await createUser(env.DB, env)
    const task = await createTask(env.DB, userA.id)

    const { status } = await req('POST', '/api/completions', env, {
      token: userB.token,
      body: { task_id: task.id, date: TODAY },
    })
    expect(status).toBe(404)
  })

  it('DELETE /completions/:id with another users completion returns 404', async () => {
    const userA = await createUser(env.DB, env)
    const userB = await createUser(env.DB, env)
    const task = await createTask(env.DB, userA.id)
    const completion = await createCompletion(env.DB, task.id, userA.id, TODAY)

    const { status } = await req('DELETE', `/api/completions/${completion.id}`, env, {
      token: userB.token,
    })
    expect(status).toBe(404)
    // Confirm it was NOT deleted
    const row = await env.DB.prepare('SELECT id FROM completions WHERE id = ?')
      .bind(completion.id).first()
    expect(row).not.toBeNull()
  })

  it('GET /completions only returns own completions', async () => {
    const userA = await createUser(env.DB, env)
    const userB = await createUser(env.DB, env)
    const task = await createTask(env.DB, userA.id)
    await createCompletion(env.DB, task.id, userA.id, TODAY)

    const { body } = await req(`GET`, `/api/completions?date=${TODAY}`, env, { token: userB.token })
    expect((body as any).data.completions).toHaveLength(0)
  })
})

describe('IDOR — Analytics', () => {
  it('GET /analytics/task/:id with another users task returns 404', async () => {
    const userA = await createUser(env.DB, env)
    const userB = await createUser(env.DB, env)
    const task = await createTask(env.DB, userA.id)

    const { status } = await req(`GET`, `/api/analytics/task/${task.id}`, env, { token: userB.token })
    expect(status).toBe(404)
  })
})
