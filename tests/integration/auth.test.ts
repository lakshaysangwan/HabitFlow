import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { applyMigrations, createUser, createInviteCode, req } from '../helpers'

beforeAll(async () => {
  await applyMigrations(env.DB)
})

// ─── POST /api/auth/login ──────────────────────────────────────────────────────

describe('POST /api/auth/login — login', () => {
  it('logs in an existing user with correct credentials', async () => {
    const user = await createUser(env.DB, env)
    const { status, body } = await req('POST', '/api/auth/login', env, {
      body: { username: user.username, password: user.password },
    })
    expect(status).toBe(200)
    expect((body as any).ok).toBe(true)
    expect((body as any).data.user.username).toBe(user.username)
  })

  it('returns 401 for wrong password', async () => {
    const user = await createUser(env.DB, env)
    const { status, body } = await req('POST', '/api/auth/login', env, {
      body: { username: user.username, password: 'wrongpassword' },
    })
    expect(status).toBe(401)
    expect((body as any).error.code).toBe('INVALID_CREDENTIALS')
  })

  it('returns 401 and INVITE_REQUIRED for unknown user with no invite code', async () => {
    const { status, body } = await req('POST', '/api/auth/login', env, {
      body: { username: 'brandnewuser999', password: 'somepassword' },
    })
    expect(status).toBe(401)
    expect((body as any).error.code).toBe('INVITE_REQUIRED')
  })

  it('validates schema: username too short', async () => {
    const { status } = await req('POST', '/api/auth/login', env, {
      body: { username: 'ab', password: 'password123' },
    })
    expect(status).toBe(400)
  })
})

describe('POST /api/auth/login — registration', () => {
  it('registers a new user with a valid invite code', async () => {
    const code = await createInviteCode(env.DB)
    const username = `newreg_${Date.now()}`
    const { status, body } = await req('POST', '/api/auth/login', env, {
      body: { username, password: 'newpassword1', invite_code: code },
    })
    expect(status).toBe(201)
    expect((body as any).ok).toBe(true)
    expect((body as any).data.user.username).toBe(username)
  })

  it('returns 400 for invalid or exhausted invite code', async () => {
    const code = await createInviteCode(env.DB, undefined, 0)
    const { status, body } = await req('POST', '/api/auth/login', env, {
      body: { username: `wontwork_${Date.now()}`, password: 'password123', invite_code: code },
    })
    expect(status).toBe(400)
    expect((body as any).error.code).toBe('INVALID_INVITE')
  })

  it('increments current_uses on invite code after registration', async () => {
    const code = await createInviteCode(env.DB)
    await req('POST', '/api/auth/login', env, {
      body: { username: `inctest_${Date.now()}`, password: 'password123', invite_code: code },
    })
    const row = await env.DB.prepare('SELECT current_uses FROM invite_codes WHERE code = ?')
      .bind(code).first<{ current_uses: number }>()
    expect(row!.current_uses).toBe(1)
  })
})

// ─── POST /api/auth/logout ─────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  it('returns 200 with Set-Cookie that clears token', async () => {
    const user = await createUser(env.DB, env)
    // We test via req helper — can't inspect Set-Cookie directly, check ok
    const { status, body } = await req('POST', '/api/auth/logout', env, {
      token: user.token,
    })
    expect(status).toBe(200)
    expect((body as any).ok).toBe(true)
  })

  it('returns 200 even without a token (unauthenticated logout is safe)', async () => {
    const { status } = await req('POST', '/api/auth/logout', env)
    expect(status).toBe(200)
  })
})

// ─── GET /api/auth/me ──────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  it('returns the authenticated user', async () => {
    const user = await createUser(env.DB, env)
    const { status, body } = await req('GET', '/api/auth/me', env, { token: user.token })
    expect(status).toBe(200)
    expect((body as any).data.user.username).toBe(user.username)
  })

  it('returns 401 without token', async () => {
    const { status } = await req('GET', '/api/auth/me', env)
    expect(status).toBe(401)
  })

  it('does not expose password_hash or token_version', async () => {
    const user = await createUser(env.DB, env)
    const { body } = await req('GET', '/api/auth/me', env, { token: user.token })
    const u = (body as any).data.user
    expect(u.password_hash).toBeUndefined()
    expect(u.token_version).toBeUndefined()
  })
})

// ─── PATCH /api/auth/password ──────────────────────────────────────────────────

describe('PATCH /api/auth/password', () => {
  it('changes password successfully', async () => {
    const user = await createUser(env.DB, env)
    const { status } = await req('PATCH', '/api/auth/password', env, {
      token: user.token,
      body: {
        old_password: user.password,
        new_password: 'newpassword999',
        confirm_password: 'newpassword999',
      },
    })
    expect(status).toBe(200)
  })

  it('returns 400 for wrong old password', async () => {
    const user = await createUser(env.DB, env)
    const { status, body } = await req('PATCH', '/api/auth/password', env, {
      token: user.token,
      body: { old_password: 'wrongold', new_password: 'newpass999', confirm_password: 'newpass999' },
    })
    expect(status).toBe(400)
    expect((body as any).error.code).toBe('INVALID_PASSWORD')
  })

  it('returns 400 when new and confirm passwords do not match', async () => {
    const user = await createUser(env.DB, env)
    const { status, body } = await req('PATCH', '/api/auth/password', env, {
      token: user.token,
      body: { old_password: user.password, new_password: 'newpass999', confirm_password: 'different' },
    })
    expect(status).toBe(400)
    expect((body as any).error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 400 when new password is same as old', async () => {
    const user = await createUser(env.DB, env)
    const { status, body } = await req('PATCH', '/api/auth/password', env, {
      token: user.token,
      body: { old_password: user.password, new_password: user.password, confirm_password: user.password },
    })
    expect(status).toBe(400)
    expect((body as any).error.code).toBe('SAME_PASSWORD')
  })

  it('increments token_version after password change (invalidates old tokens)', async () => {
    const user = await createUser(env.DB, env)
    await req('PATCH', '/api/auth/password', env, {
      token: user.token,
      body: { old_password: user.password, new_password: 'brandnew999', confirm_password: 'brandnew999' },
    })
    // Old token should now be rejected
    const { status } = await req('GET', '/api/auth/me', env, { token: user.token })
    expect(status).toBe(401)
  })
})

// ─── PATCH /api/auth/profile ───────────────────────────────────────────────────

describe('PATCH /api/auth/profile', () => {
  it('updates display_name', async () => {
    const user = await createUser(env.DB, env)
    const { status, body } = await req('PATCH', '/api/auth/profile', env, {
      token: user.token,
      body: { display_name: 'Alice Wonder' },
    })
    expect(status).toBe(200)
    expect((body as any).data.user.display_name).toBe('Alice Wonder')
  })

  it('updates timezone with valid IANA string', async () => {
    const user = await createUser(env.DB, env)
    const { status, body } = await req('PATCH', '/api/auth/profile', env, {
      token: user.token,
      body: { timezone: 'America/New_York' },
    })
    expect(status).toBe(200)
    expect((body as any).data.user.timezone).toBe('America/New_York')
  })

  it('returns 400 for invalid timezone', async () => {
    const user = await createUser(env.DB, env)
    const { status, body } = await req('PATCH', '/api/auth/profile', env, {
      token: user.token,
      body: { timezone: 'Not/A/Timezone' },
    })
    expect(status).toBe(400)
    expect((body as any).error.code).toBe('INVALID_TIMEZONE')
  })

  it('returns 400 when nothing to update', async () => {
    const user = await createUser(env.DB, env)
    const { status, body } = await req('PATCH', '/api/auth/profile', env, {
      token: user.token,
      body: {},
    })
    expect(status).toBe(400)
    expect((body as any).error.code).toBe('NO_CHANGES')
  })
})
