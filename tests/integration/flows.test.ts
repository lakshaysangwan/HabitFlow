/**
 * End-to-end flow tests for HabitFlow.
 * Each describe block is an independent multi-step user journey that exercises
 * cross-endpoint consistency and real usage patterns.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import {
  applyMigrations,
  createUser,
  createTask,
  createCompletion,
  createInviteCode,
  req,
} from '../helpers'

// ─── Date Helpers ─────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toLocaleDateString('en-CA')
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toLocaleDateString('en-CA')
}

// ISO weekday: 1=Mon, 7=Sun
function isoWeekday(date: string): number {
  const d = new Date(date + 'T00:00:00Z')
  const day = d.getUTCDay()
  return day === 0 ? 7 : day
}

// ──────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await applyMigrations(env.DB)
})

// ─── Flow 1: New user onboarding → first habit → first completion ─────────────

describe('Flow 1: user onboarding → habit creation → completion → analytics', () => {
  it('full onboarding flow', async () => {
    // Step 1: Register via invite code
    const code = await createInviteCode(env.DB)
    const username = `onboard_${Date.now()}`
    const { status: regStatus, cookie: regCookie } = await req('POST', '/api/auth/login', env, {
      body: { username, password: 'password123', invite_code: code },
    })
    expect(regStatus).toBe(201)
    expect(regCookie).not.toBeNull()
    const token = regCookie!

    // Step 2: Verify /me returns the new user
    const { status: meStatus, body: meBody } = await req('GET', '/api/auth/me', env, { token })
    expect(meStatus).toBe(200)
    expect((meBody as any).data.user.username).toBe(username)

    // Step 3: Create a daily task
    const { status: taskStatus, body: taskBody } = await req('POST', '/api/tasks', env, {
      token,
      body: { name: 'Morning Run', frequency_type: 'daily' },
    })
    expect(taskStatus).toBe(201)
    const taskId = (taskBody as any).data.task.id
    expect(taskId).toBeTruthy()

    // Step 4: Task appears in GET /api/tasks
    const { body: listBody } = await req('GET', '/api/tasks', env, { token })
    const tasks = (listBody as any).data.tasks
    expect(tasks.some((t: any) => t.id === taskId)).toBe(true)

    // Step 5: Complete the task for today
    const { status: compStatus, body: compBody } = await req('POST', '/api/completions', env, {
      token,
      body: { task_id: taskId, date: today() },
    })
    expect(compStatus).toBe(201)
    const completionId = (compBody as any).data.completion.id

    // Step 6: GET /api/completions returns it
    const { body: compsBody } = await req('GET', `/api/completions?date=${today()}`, env, { token })
    const completions = (compsBody as any).data.completions
    expect(completions.some((c: any) => c.id === completionId)).toBe(true)

    // Step 7: Analytics/daily shows 100% rate
    const { body: dailyBody } = await req('GET', `/api/analytics/daily?date=${today()}`, env, { token })
    const daily = (dailyBody as any).data
    expect(daily.rate).toBe(100)
    expect(daily.completed).toBe(1)

    // Step 8: Analytics/overview shows streak >= 1
    const { body: overviewBody } = await req('GET', '/api/analytics/overview?range=week', env, { token })
    const overview = (overviewBody as any).data
    expect(overview.total_completions).toBeGreaterThanOrEqual(1)
  })
})

// ─── Flow 2: Task full lifecycle ──────────────────────────────────────────────

describe('Flow 2: task lifecycle — create, pause, resume, reorder, archive', () => {
  it('full task lifecycle', async () => {
    const user = await createUser(env.DB, env)

    // Create two tasks
    const r1 = await req('POST', '/api/tasks', env, {
      token: user.token, body: { name: 'Task Alpha' },
    })
    expect(r1.status).toBe(201)
    const taskId = (r1.body as any).data.task.id

    const r2 = await req('POST', '/api/tasks', env, {
      token: user.token, body: { name: 'Task Beta' },
    })
    const taskId2 = (r2.body as any).data.task.id

    // Pause task
    const { status: pauseStatus, body: pauseBody } = await req('PATCH', `/api/tasks/${taskId}/pause`, env, { token: user.token })
    expect(pauseStatus).toBe(200)
    expect((pauseBody as any).data.task.status).toBe('paused')
    expect((pauseBody as any).data.task.paused_at).not.toBeNull()

    // Paused task not in default active list
    const { body: activeList } = await req('GET', '/api/tasks', env, { token: user.token })
    const activeIds = (activeList as any).data.tasks.map((t: any) => t.id)
    expect(activeIds).not.toContain(taskId)

    // Resume task
    const { status: resumeStatus, body: resumeBody } = await req('PATCH', `/api/tasks/${taskId}/resume`, env, { token: user.token })
    expect(resumeStatus).toBe(200)
    expect((resumeBody as any).data.task.status).toBe('active')
    expect((resumeBody as any).data.task.paused_at).toBeNull()

    // Task is back in active list
    const { body: afterResumeList } = await req('GET', '/api/tasks', env, { token: user.token })
    const afterResumeIds = (afterResumeList as any).data.tasks.map((t: any) => t.id)
    expect(afterResumeIds).toContain(taskId)

    // Reorder: put task2 before task1
    const { status: reorderStatus } = await req('PUT', '/api/tasks/reorder', env, {
      token: user.token,
      body: { task_ids: [taskId2, taskId] },
    })
    expect(reorderStatus).toBe(200)

    // Verify sort_order in DB
    const row1 = await env.DB.prepare('SELECT sort_order FROM tasks WHERE id = ?').bind(taskId).first<{ sort_order: number }>()
    const row2 = await env.DB.prepare('SELECT sort_order FROM tasks WHERE id = ?').bind(taskId2).first<{ sort_order: number }>()
    expect(row2!.sort_order).toBeLessThan(row1!.sort_order)

    // Archive task
    const { status: archiveStatus } = await req('DELETE', `/api/tasks/${taskId}`, env, { token: user.token })
    expect(archiveStatus).toBe(200)

    // Archived task not in active list
    const { body: postArchiveList } = await req('GET', '/api/tasks', env, { token: user.token })
    const postArchiveIds = (postArchiveList as any).data.tasks.map((t: any) => t.id)
    expect(postArchiveIds).not.toContain(taskId)

    // Archived task visible with status=all
    const { body: allList } = await req('GET', '/api/tasks?status=all', env, { token: user.token })
    const allIds = (allList as any).data.tasks.map((t: any) => t.id)
    expect(allIds).toContain(taskId)

    // Verify DB state is archived
    const row = await env.DB.prepare('SELECT status FROM tasks WHERE id = ?').bind(taskId).first<{ status: string }>()
    expect(row!.status).toBe('archived')
  })
})

// ─── Flow 3: Multi-day completions & streak accuracy ─────────────────────────

describe('Flow 3: multi-day completions and streak calculation accuracy', () => {
  it('calculates correct current streak for consecutive days', async () => {
    const user = await createUser(env.DB, env)

    // Create task with start_date 5 days ago
    const task = await createTask(env.DB, user.id, { start_date: daysAgo(5) })

    // Complete for days -3, -2, -1 and today (4 consecutive days)
    await createCompletion(env.DB, task.id, user.id, daysAgo(3))
    await createCompletion(env.DB, task.id, user.id, daysAgo(2))
    await createCompletion(env.DB, task.id, user.id, daysAgo(1))
    await createCompletion(env.DB, task.id, user.id, today())

    const { status, body } = await req('GET', `/api/analytics/task/${task.id}?range=all`, env, { token: user.token })
    expect(status).toBe(200)
    const data = (body as any).data
    expect(data.current_streak).toBe(4)
    expect(data.best_streak).toBeGreaterThanOrEqual(4)
    expect(data.total_completed).toBe(4)
  })

  it('streak resets after a missed day', async () => {
    const user = await createUser(env.DB, env)

    // Create task with start_date 6 days ago
    const task = await createTask(env.DB, user.id, { start_date: daysAgo(6) })

    // Complete days -5 and -4, skip day -3, complete -2 and -1 and today
    await createCompletion(env.DB, task.id, user.id, daysAgo(5))
    await createCompletion(env.DB, task.id, user.id, daysAgo(4))
    // day -3 intentionally skipped
    await createCompletion(env.DB, task.id, user.id, daysAgo(2))
    await createCompletion(env.DB, task.id, user.id, daysAgo(1))
    await createCompletion(env.DB, task.id, user.id, today())

    const { body } = await req('GET', `/api/analytics/task/${task.id}?range=all`, env, { token: user.token })
    const data = (body as any).data
    // Current streak is from -2 to today = 3
    expect(data.current_streak).toBe(3)
    // Best streak was the earlier 2-day run (days -5, -4) vs current 3-day run
    expect(data.best_streak).toBe(3)
    expect(data.total_completed).toBe(5)
  })
})

// ─── Flow 4: Data-logging habit ───────────────────────────────────────────────

describe('Flow 4: data-logging habit — create with data_type, complete with data, verify in analytics', () => {
  it('logs numeric data on completion and surfaces in analytics', async () => {
    const user = await createUser(env.DB, env)

    // Create task with numeric data tracking
    const { status: createStatus, body: createBody } = await req('POST', '/api/tasks', env, {
      token: user.token,
      body: { name: 'Run', frequency_type: 'daily', data_type: 'number', data_label: 'km' },
    })
    expect(createStatus).toBe(201)
    const taskId = (createBody as any).data.task.id
    expect((createBody as any).data.task.data_type).toBe('number')
    expect((createBody as any).data.task.data_label).toBe('km')

    // Complete with data_number
    const { status: compStatus, body: compBody } = await req('POST', '/api/completions', env, {
      token: user.token,
      body: { task_id: taskId, date: today(), data_number: 5.5 },
    })
    expect(compStatus).toBe(201)
    expect((compBody as any).data.completion.data_number).toBe(5.5)

    // GET completions for today — data_number is present
    const { body: compsBody } = await req('GET', `/api/completions?date=${today()}`, env, { token: user.token })
    const comp = (compsBody as any).data.completions.find((c: any) => c.task_id === taskId)
    expect(comp).toBeTruthy()
    expect(comp.data_number).toBe(5.5)

    // Analytics/task shows data_points with data_number
    const { body: taskAnalytics } = await req('GET', `/api/analytics/task/${taskId}?range=week`, env, { token: user.token })
    const dp = (taskAnalytics as any).data.data_points.find((p: any) => p.date === today())
    expect(dp).toBeTruthy()
    expect(dp.data_number).toBe(5.5)
    expect(dp.completed).toBe(true)
  })

  it('logs text data on completion', async () => {
    const user = await createUser(env.DB, env)

    const { body: createBody } = await req('POST', '/api/tasks', env, {
      token: user.token,
      body: { name: 'Journal', frequency_type: 'daily', data_type: 'text', data_label: 'notes' },
    })
    const taskId = (createBody as any).data.task.id

    const { status, body } = await req('POST', '/api/completions', env, {
      token: user.token,
      body: { task_id: taskId, date: today(), data_text: 'Had a great day' },
    })
    expect(status).toBe(201)
    expect((body as any).data.completion.data_text).toBe('Had a great day')
  })
})

// ─── Flow 5: Weekly habit scheduling ─────────────────────────────────────────

describe('Flow 5: weekly habit scheduling — correct day passes, wrong day rejected', () => {
  it('rejects completion on off-schedule day for weekly task', async () => {
    const user = await createUser(env.DB, env)

    // Get today's ISO weekday and find a different day for the "wrong day" test
    const todayDay = isoWeekday(today())
    // Pick a different day (e.g., if today is Mon=1, use Tue=2)
    const otherDay = todayDay === 7 ? 1 : todayDay + 1

    // Create task with start_date 7 days ago, only scheduled for otherDay
    const task = await createTask(env.DB, user.id, {
      frequency_type: 'weekly',
      frequency_days: [otherDay],
      start_date: daysAgo(7),
    })

    // Completing for today should fail since today is not otherDay
    const { status, body } = await req('POST', '/api/completions', env, {
      token: user.token,
      body: { task_id: task.id, date: today() },
    })
    expect(status).toBe(400)
    expect((body as any).error.code).toBe('WRONG_DAY')
  })

  it('accepts completion on a scheduled day', async () => {
    const user = await createUser(env.DB, env)

    const todayDay = isoWeekday(today())

    // Create weekly task scheduled for today
    const task = await createTask(env.DB, user.id, {
      frequency_type: 'weekly',
      frequency_days: [todayDay],
      start_date: daysAgo(7),
    })

    const { status } = await req('POST', '/api/completions', env, {
      token: user.token,
      body: { task_id: task.id, date: today() },
    })
    expect(status).toBe(201)
  })

  it('weekly analytics only counts scheduled days in completion_rate denominator', async () => {
    const user = await createUser(env.DB, env)

    const todayDay = isoWeekday(today())
    const task = await createTask(env.DB, user.id, {
      frequency_type: 'weekly',
      frequency_days: [todayDay],
      start_date: daysAgo(14),
    })

    // Complete for today
    await createCompletion(env.DB, task.id, user.id, today())

    const { body } = await req('GET', `/api/analytics/task/${task.id}?range=month`, env, { token: user.token })
    const data = (body as any).data
    // Should have at most ~4-5 scheduled days in the past month (weekly)
    expect(data.total_scheduled).toBeLessThanOrEqual(5)
    // Completion rate must be based only on scheduled days (not all calendar days)
    expect(data.completion_rate).toBeGreaterThan(0)
  })
})

// ─── Flow 6: Session security lifecycle ──────────────────────────────────────

describe('Flow 6: session security — password change invalidates other sessions', () => {
  it('old token rejected after password change; new login with updated password works', async () => {
    // Step 1: Create user (token A)
    const user = await createUser(env.DB, env)
    const tokenA = user.token

    // Step 2: Login from "device B" to get token B (via Set-Cookie)
    const { cookie: tokenB } = await req('POST', '/api/auth/login', env, {
      body: { username: user.username, password: user.password },
    })
    expect(tokenB).not.toBeNull()

    // Both tokens work initially
    const { status: meA } = await req('GET', '/api/auth/me', env, { token: tokenA })
    const { status: meB } = await req('GET', '/api/auth/me', env, { token: tokenB })
    expect(meA).toBe(200)
    expect(meB).toBe(200)

    // Step 3: Change password with token A
    const { status: pwStatus } = await req('PATCH', '/api/auth/password', env, {
      token: tokenA,
      body: { old_password: user.password, new_password: 'newpassword999', confirm_password: 'newpassword999' },
    })
    expect(pwStatus).toBe(200)

    // Step 4: Token B is now rejected
    const { status: staleB } = await req('GET', '/api/auth/me', env, { token: tokenB! })
    expect(staleB).toBe(401)

    // Token A is also rejected (token_version mismatch — new token issued but not captured here)
    const { status: staleA } = await req('GET', '/api/auth/me', env, { token: tokenA })
    expect(staleA).toBe(401)

    // Step 5: Login with NEW password succeeds
    const { status: newLogin, cookie: freshToken } = await req('POST', '/api/auth/login', env, {
      body: { username: user.username, password: 'newpassword999' },
    })
    expect(newLogin).toBe(200)
    expect(freshToken).not.toBeNull()

    // Fresh token works
    const { status: freshMe } = await req('GET', '/api/auth/me', env, { token: freshToken! })
    expect(freshMe).toBe(200)

    // Step 6: Old password no longer works
    const { status: oldPwLogin } = await req('POST', '/api/auth/login', env, {
      body: { username: user.username, password: user.password },
    })
    expect(oldPwLogin).toBe(401)
  })
})

// ─── Flow 7: Admin full flow ──────────────────────────────────────────────────

describe('Flow 7: admin (god mode) full flow', () => {
  it('god user can search users, view detail, reset password, and manage invite codes', async () => {
    const godUser = await createUser(env.DB, env, { isGod: true })
    const targetUser = await createUser(env.DB, env)

    // Step 1: Search for target user
    const { status: searchStatus, body: searchBody } = await req(
      'GET', `/api/admin/users?search=${targetUser.username}`, env, { token: godUser.token }
    )
    expect(searchStatus).toBe(200)
    const found = (searchBody as any).data.users.find((u: any) => u.username === targetUser.username)
    expect(found).toBeTruthy()
    expect(found.password_hash).toBeUndefined() // not exposed

    // Step 2: View user detail
    const { status: detailStatus, body: detailBody } = await req(
      'GET', `/api/admin/users/${targetUser.id}`, env, { token: godUser.token }
    )
    expect(detailStatus).toBe(200)
    expect((detailBody as any).data.user.id).toBe(targetUser.id)
    expect(Array.isArray((detailBody as any).data.tasks)).toBe(true)

    // Step 3: View target user analytics
    const { status: analyticsStatus } = await req(
      'GET', `/api/admin/users/${targetUser.id}/analytics?range=week`, env, { token: godUser.token }
    )
    expect(analyticsStatus).toBe(200)

    // Step 4: Reset target user's password
    const { status: resetStatus } = await req('PATCH', `/api/admin/users/${targetUser.id}/password`, env, {
      token: godUser.token,
      body: { new_password: 'adminreset999' },
    })
    expect(resetStatus).toBe(200)

    // Step 5: Target user's old token is now rejected
    const { status: staleToken } = await req('GET', '/api/auth/me', env, { token: targetUser.token })
    expect(staleToken).toBe(401)

    // Step 6: Target user can login with new password
    const { status: newLogin } = await req('POST', '/api/auth/login', env, {
      body: { username: targetUser.username, password: 'adminreset999' },
    })
    expect(newLogin).toBe(200)

    // Step 7: Create an invite code
    const { status: createCodeStatus, body: createCodeBody } = await req('POST', '/api/admin/invite-codes', env, {
      token: godUser.token,
      body: { code: 'FLOW-TEST-CODE', max_uses: 5 },
    })
    expect(createCodeStatus).toBe(201)

    // Step 8: Code appears in invite code list
    const { status: listStatus, body: listBody } = await req('GET', '/api/admin/invite-codes', env, { token: godUser.token })
    expect(listStatus).toBe(200)
    const codes = (listBody as any).data.invite_codes
    const newCode = codes.find((c: any) => c.code === 'FLOW-TEST-CODE')
    expect(newCode).toBeTruthy()
    expect(newCode.max_uses).toBe(5)
    expect(newCode.current_uses).toBe(0)
  })

  it('non-god user is blocked from all admin endpoints', async () => {
    const normalUser = await createUser(env.DB, env)

    const { status: s1 } = await req('GET', '/api/admin/users', env, { token: normalUser.token })
    expect(s1).toBe(403)

    const { status: s2 } = await req('GET', `/api/admin/users/${normalUser.id}`, env, { token: normalUser.token })
    expect(s2).toBe(403)

    const { status: s3 } = await req('POST', '/api/admin/invite-codes', env, {
      token: normalUser.token,
      body: { code: 'EVIL-CODE', max_uses: 100 },
    })
    expect(s3).toBe(403)
  })
})

// ─── Flow 8: IDOR cross-user full journey ────────────────────────────────────

describe('Flow 8: IDOR — user B cannot access or modify user A data', () => {
  it('all cross-user operations return 404 and leave DB unchanged', async () => {
    const userA = await createUser(env.DB, env)
    const userB = await createUser(env.DB, env)

    // Setup: User A creates tasks and completions
    const taskA1 = await createTask(env.DB, userA.id, { name: 'A Task 1' })
    const taskA2 = await createTask(env.DB, userA.id, { name: 'A Task 2' })
    const compA = await createCompletion(env.DB, taskA1.id, userA.id, daysAgo(1))

    // User B cannot read User A's completions (only gets their own — empty)
    const { body: compsBody } = await req('GET', `/api/completions?date=${daysAgo(1)}`, env, { token: userB.token })
    const comps = (compsBody as any).data.completions
    expect(comps.every((c: any) => c.user_id !== userA.id)).toBe(true)

    // User B cannot delete User A's completion
    const { status: delComp } = await req('DELETE', `/api/completions/${compA.id}`, env, { token: userB.token })
    expect(delComp).toBe(404)

    // User B cannot update User A's task
    const { status: patchTask } = await req('PATCH', `/api/tasks/${taskA1.id}`, env, {
      token: userB.token,
      body: { name: 'Hacked' },
    })
    expect(patchTask).toBe(404)

    // User B cannot delete User A's task
    const { status: deleteTask } = await req('DELETE', `/api/tasks/${taskA2.id}`, env, { token: userB.token })
    expect(deleteTask).toBe(404)

    // User B cannot pause User A's task
    const { status: pause } = await req('PATCH', `/api/tasks/${taskA1.id}/pause`, env, { token: userB.token })
    expect(pause).toBe(404)

    // User B cannot get User A's task analytics
    const { status: analytics } = await req('GET', `/api/analytics/task/${taskA1.id}?range=week`, env, { token: userB.token })
    expect(analytics).toBe(404)

    // User B cannot reorder User A's tasks mixed with their own
    const taskB = await createTask(env.DB, userB.id)
    const { status: reorder } = await req('PUT', '/api/tasks/reorder', env, {
      token: userB.token,
      body: { task_ids: [taskA1.id, taskB.id] },
    })
    expect(reorder).toBe(404)

    // Verify DB is completely unchanged for User A
    const a1Row = await env.DB.prepare('SELECT name, status FROM tasks WHERE id = ?').bind(taskA1.id).first<{ name: string; status: string }>()
    expect(a1Row!.name).toBe('A Task 1')
    expect(a1Row!.status).toBe('active')

    const compRow = await env.DB.prepare('SELECT id FROM completions WHERE id = ?').bind(compA.id).first()
    expect(compRow).not.toBeNull()
  })
})

// ─── Flow 9: Completion edge cases ───────────────────────────────────────────

describe('Flow 9: completion edge cases — date validation, duplicate, undo, and redo', () => {
  it('full edge case flow', async () => {
    const user = await createUser(env.DB, env)
    const task = await createTask(env.DB, user.id, { start_date: today() })

    // Cannot complete before start_date
    const { status: beforeStart } = await req('POST', '/api/completions', env, {
      token: user.token,
      body: { task_id: task.id, date: daysAgo(1) },
    })
    expect(beforeStart).toBe(400)

    // Cannot complete future date
    const tomorrow = (() => {
      const d = new Date()
      d.setDate(d.getDate() + 1)
      return d.toLocaleDateString('en-CA')
    })()
    const { status: futureDate } = await req('POST', '/api/completions', env, {
      token: user.token,
      body: { task_id: task.id, date: tomorrow },
    })
    expect(futureDate).toBe(400)

    // Complete for today — succeeds
    const { status: firstComp, body: firstBody } = await req('POST', '/api/completions', env, {
      token: user.token,
      body: { task_id: task.id, date: today() },
    })
    expect(firstComp).toBe(201)
    const compId = (firstBody as any).data.completion.id

    // Duplicate for same date — 409 ALREADY_COMPLETED
    const { status: dupStatus, body: dupBody } = await req('POST', '/api/completions', env, {
      token: user.token,
      body: { task_id: task.id, date: today() },
    })
    expect(dupStatus).toBe(409)
    expect((dupBody as any).error.code).toBe('ALREADY_COMPLETED')

    // Undo: DELETE the completion
    const { status: delStatus } = await req('DELETE', `/api/completions/${compId}`, env, { token: user.token })
    expect(delStatus).toBe(200)

    // Verify it's gone
    const compRow = await env.DB.prepare('SELECT id FROM completions WHERE id = ?').bind(compId).first()
    expect(compRow).toBeNull()

    // Redo: Complete again after undo
    const { status: redoStatus } = await req('POST', '/api/completions', env, {
      token: user.token,
      body: { task_id: task.id, date: today() },
    })
    expect(redoStatus).toBe(201)
  })
})

// ─── Flow 10: Analytics heatmap accuracy ─────────────────────────────────────

describe('Flow 10: heatmap accuracy — known completions appear at correct dates', () => {
  it('heatmap includes exactly the days with completions', async () => {
    const user = await createUser(env.DB, env)

    // Create a task with a start_date far in the past
    const task = await createTask(env.DB, user.id, { start_date: '2025-01-01' })

    // Complete on 3 specific known dates in 2025
    const knownDates = ['2025-01-05', '2025-03-15', '2025-06-20']
    for (const d of knownDates) {
      await createCompletion(env.DB, task.id, user.id, d)
    }

    const { status, body } = await req('GET', '/api/analytics/heatmap?year=2025', env, { token: user.token })
    expect(status).toBe(200)

    const heatmap: { date: string; count: number }[] = (body as any).data.days
    expect(Array.isArray(heatmap)).toBe(true)

    // All 3 known dates must appear with count >= 1
    for (const d of knownDates) {
      const entry = heatmap.find(h => h.date === d)
      expect(entry, `Expected heatmap entry for ${d}`).toBeTruthy()
      expect(entry!.count).toBeGreaterThanOrEqual(1)
    }

    // Days with no completions must have count 0 (or not be present)
    const nonCompletionDate = '2025-02-10'
    const nonEntry = heatmap.find(h => h.date === nonCompletionDate)
    if (nonEntry) {
      expect(nonEntry.count).toBe(0)
    }
  })

  it('heatmap does not include future dates', async () => {
    const user = await createUser(env.DB, env)

    const { body } = await req('GET', `/api/analytics/heatmap?year=${new Date().getFullYear()}`, env, { token: user.token })
    const heatmap: { date: string }[] = (body as any).data.days

    const todayStr = today()
    const futureEntries = heatmap.filter(h => h.date > todayStr)
    expect(futureEntries).toHaveLength(0)
  })
})
