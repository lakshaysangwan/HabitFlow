import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { applyMigrations, createUser, createTask, createCompletion, createInviteCode, req } from '../helpers'

beforeAll(async () => {
  await applyMigrations(env.DB)
})

const TODAY = new Date().toLocaleDateString('en-CA')

// ─── Auth guard (all admin endpoints require is_god=1) ─────────────────────────

describe('Admin auth guard', () => {
  it('returns 403 for normal (non-god) users on GET /admin/users', async () => {
    const user = await createUser(env.DB, env)
    const { status } = await req('GET', '/api/admin/users', env, { token: user.token })
    expect(status).toBe(403)
  })

  it('returns 401 for unauthenticated requests to GET /admin/users', async () => {
    const { status } = await req('GET', '/api/admin/users', env)
    expect(status).toBe(401)
  })

  it('returns 403 for normal user on POST /admin/invite-codes', async () => {
    const user = await createUser(env.DB, env)
    const { status } = await req('POST', '/api/admin/invite-codes', env, {
      token: user.token,
      body: { code: 'TEST-CODE-1' },
    })
    expect(status).toBe(403)
  })
})

// ─── GET /api/admin/users ─────────────────────────────────────────────────────

describe('GET /api/admin/users', () => {
  it('returns paginated user list for god user', async () => {
    const god = await createUser(env.DB, env, { isGod: true })
    await createUser(env.DB, env)
    const { status, body } = await req('GET', '/api/admin/users', env, { token: god.token })
    expect(status).toBe(200)
    expect(Array.isArray((body as any).data.users)).toBe(true)
    expect((body as any).data.users.length).toBeGreaterThan(0)
  })

  it('searches by username', async () => {
    const god = await createUser(env.DB, env, { isGod: true })
    const unique = `findme_${Date.now()}`
    await createUser(env.DB, env, { username: unique })
    const { body } = await req(`GET`, `/api/admin/users?search=${unique}`, env, { token: god.token })
    const users = (body as any).data.users
    expect(users.some((u: any) => u.username === unique)).toBe(true)
  })

  it('does not expose password_hash in user list', async () => {
    const god = await createUser(env.DB, env, { isGod: true })
    const { body } = await req('GET', '/api/admin/users', env, { token: god.token })
    const users = (body as any).data.users
    expect(users.every((u: any) => u.password_hash === undefined)).toBe(true)
  })

  it('respects page and limit params', async () => {
    const god = await createUser(env.DB, env, { isGod: true })
    const { body } = await req('GET', '/api/admin/users?page=1&limit=2', env, { token: god.token })
    expect((body as any).data.users.length).toBeLessThanOrEqual(2)
    expect((body as any).data.page).toBe(1)
    expect((body as any).data.limit).toBe(2)
  })
})

// ─── GET /api/admin/users/:id ──────────────────────────────────────────────────

describe('GET /api/admin/users/:id', () => {
  it('returns user detail with tasks and recent completions', async () => {
    const god = await createUser(env.DB, env, { isGod: true })
    const target = await createUser(env.DB, env)
    const task = await createTask(env.DB, target.id)
    await createCompletion(env.DB, task.id, target.id, TODAY)

    const { status, body } = await req(`GET`, `/api/admin/users/${target.id}`, env, {
      token: god.token,
    })
    expect(status).toBe(200)
    const data = (body as any).data
    expect(data.user.id).toBe(target.id)
    expect(Array.isArray(data.tasks)).toBe(true)
    expect(Array.isArray(data.recent_completions)).toBe(true)
    expect(data.recent_completions.length).toBeGreaterThan(0)
  })

  it('returns 404 for non-existent user', async () => {
    const god = await createUser(env.DB, env, { isGod: true })
    const { status } = await req('GET', '/api/admin/users/nonexistentid', env, { token: god.token })
    expect(status).toBe(404)
  })
})

// ─── GET /api/admin/users/:id/analytics ───────────────────────────────────────

describe('GET /api/admin/users/:id/analytics', () => {
  it('returns real analytics overview for target user', async () => {
    const god = await createUser(env.DB, env, { isGod: true })
    const target = await createUser(env.DB, env)
    await createTask(env.DB, target.id)

    const { status, body } = await req(
      'GET', `/api/admin/users/${target.id}/analytics?range=week`, env,
      { token: god.token }
    )
    expect(status).toBe(200)
    const data = (body as any).data
    expect(data.target_user_id).toBe(target.id)
    expect(data.range).toBe('week')
    expect(Array.isArray(data.daily_rates)).toBe(true)
    expect(typeof data.current_streak).toBe('number')
    expect(Array.isArray(data.task_breakdown)).toBe(true)
  })

  it('returns 404 for non-existent user', async () => {
    const god = await createUser(env.DB, env, { isGod: true })
    const { status } = await req('GET', '/api/admin/users/doesnotexist/analytics', env, {
      token: god.token,
    })
    expect(status).toBe(404)
  })

  it('returns 400 for invalid range', async () => {
    const god = await createUser(env.DB, env, { isGod: true })
    const target = await createUser(env.DB, env)
    const { status } = await req(
      'GET', `/api/admin/users/${target.id}/analytics?range=invalid`, env,
      { token: god.token }
    )
    expect(status).toBe(400)
  })
})

// ─── POST /api/admin/invite-codes ──────────────────────────────────────────────

describe('POST /api/admin/invite-codes', () => {
  it('creates a new invite code', async () => {
    const god = await createUser(env.DB, env, { isGod: true })
    const code = `NEW-CODE-${Date.now()}`
    const { status, body } = await req('POST', '/api/admin/invite-codes', env, {
      token: god.token,
      body: { code, max_uses: 5 },
    })
    expect(status).toBe(201)
    expect((body as any).data.invite_code.code).toBe(code)
    expect((body as any).data.invite_code.max_uses).toBe(5)
    expect((body as any).data.invite_code.current_uses).toBe(0)
  })

  it('returns 409 for duplicate code', async () => {
    const god = await createUser(env.DB, env, { isGod: true })
    const code = `DUP-${Date.now()}`
    await req('POST', '/api/admin/invite-codes', env, {
      token: god.token, body: { code },
    })
    const { status, body } = await req('POST', '/api/admin/invite-codes', env, {
      token: god.token, body: { code },
    })
    expect(status).toBe(409)
    expect((body as any).error.code).toBe('DUPLICATE_CODE')
  })

  it('returns 400 for code with invalid characters (lowercase)', async () => {
    const god = await createUser(env.DB, env, { isGod: true })
    const { status } = await req('POST', '/api/admin/invite-codes', env, {
      token: god.token,
      body: { code: 'lowercase-code' },
    })
    expect(status).toBe(400)
  })

  it('returns 400 for code shorter than 4 chars', async () => {
    const god = await createUser(env.DB, env, { isGod: true })
    const { status } = await req('POST', '/api/admin/invite-codes', env, {
      token: god.token,
      body: { code: 'AB' },
    })
    expect(status).toBe(400)
  })
})

// ─── GET /api/admin/invite-codes ───────────────────────────────────────────────

describe('GET /api/admin/invite-codes', () => {
  it('returns all invite codes with usage counts', async () => {
    const god = await createUser(env.DB, env, { isGod: true })
    await createInviteCode(env.DB, `LIST-TEST-${Date.now()}`)

    const { status, body } = await req('GET', '/api/admin/invite-codes', env, { token: god.token })
    expect(status).toBe(200)
    const codes = (body as any).data.invite_codes
    expect(Array.isArray(codes)).toBe(true)
    expect(codes.length).toBeGreaterThan(0)
    const hasFields = codes.every((c: any) =>
      c.code !== undefined && c.max_uses !== undefined && c.current_uses !== undefined
    )
    expect(hasFields).toBe(true)
  })
})
