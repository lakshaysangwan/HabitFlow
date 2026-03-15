/**
 * Middleware security tests:
 * - JWT auth enforcement on protected routes
 * - Token revocation (token_version mismatch)
 * - Security headers on all responses
 * - CORS headers
 * - Public routes bypass auth
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { signJWT } from '../../functions/lib/jwt'
import { applyMigrations, createUser, req } from '../helpers'
import { createApp } from '../../functions/api/app'

beforeAll(async () => {
  await applyMigrations(env.DB)
})

const app = createApp()

async function rawReq(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {}
): Promise<Response> {
  const headers: Record<string, string> = {}
  if (opts.token) headers['Cookie'] = `token=${opts.token}`
  if (opts.body) headers['Content-Type'] = 'application/json'
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }),
    env
  )
}

// ─── Auth enforcement ──────────────────────────────────────────────────────────

describe('JWT auth enforcement', () => {
  it('returns 401 TOKEN_MISSING for protected route without cookie', async () => {
    const { status, body } = await req('GET', '/api/tasks', env)
    expect(status).toBe(401)
    expect((body as any).error.code).toBe('TOKEN_MISSING')
  })

  it('returns 401 TOKEN_INVALID for a garbage token', async () => {
    const { status, body } = await req('GET', '/api/tasks', env, { token: 'not.a.valid.jwt' })
    expect(status).toBe(401)
    expect((body as any).error.code).toBe('TOKEN_INVALID')
  })

  it('returns 401 TOKEN_INVALID for a token signed with wrong secret', async () => {
    const fakeToken = await signJWT(
      { sub: 'user123', username: 'hax', is_god: 0, token_version: 0 },
      { JWT_SECRET: 'completely-different-secret-here' }
    )
    const { status } = await req('GET', '/api/tasks', env, { token: fakeToken })
    expect(status).toBe(401)
  })

  it('returns 401 TOKEN_REVOKED when token_version does not match DB', async () => {
    const user = await createUser(env.DB, env)
    // Manually increment token_version in DB (simulating password change)
    await env.DB.prepare('UPDATE users SET token_version = 999 WHERE id = ?')
      .bind(user.id).run()

    const { status, body } = await req('GET', '/api/tasks', env, { token: user.token })
    expect(status).toBe(401)
    expect((body as any).error.code).toBe('TOKEN_REVOKED')
  })
})

// ─── Public routes bypass auth ─────────────────────────────────────────────────

describe('Public routes bypass auth', () => {
  it('POST /api/auth/login is accessible without token', async () => {
    const res = await rawReq('POST', '/api/auth/login', {
      body: { username: 'noexist', password: 'testpassword' },
    })
    // Should get 401 INVITE_REQUIRED (not TOKEN_MISSING)
    expect(res.status).toBe(401)
    const body = await res.json() as any
    expect(body.error.code).not.toBe('TOKEN_MISSING')
  })

  it('POST /api/auth/logout is accessible without token', async () => {
    const res = await rawReq('POST', '/api/auth/logout')
    expect(res.status).toBe(200)
  })
})

// ─── Security headers ──────────────────────────────────────────────────────────

describe('Security headers', () => {
  it('sets X-Frame-Options on API responses', async () => {
    const user = await createUser(env.DB, env)
    const res = await rawReq('GET', '/api/tasks', { token: user.token })
    expect(res.headers.get('X-Frame-Options')).toBeTruthy()
  })

  it('sets X-Content-Type-Options on API responses', async () => {
    const user = await createUser(env.DB, env)
    const res = await rawReq('GET', '/api/tasks', { token: user.token })
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('sets Referrer-Policy on API responses', async () => {
    const user = await createUser(env.DB, env)
    const res = await rawReq('GET', '/api/tasks', { token: user.token })
    expect(res.headers.get('Referrer-Policy')).toBeTruthy()
  })

  it('sets security headers on public routes too', async () => {
    const res = await rawReq('POST', '/api/auth/logout')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })
})

// ─── CORS headers ─────────────────────────────────────────────────────────────

describe('CORS headers', () => {
  it('sets Access-Control-Allow-Origin on responses', async () => {
    const res = await rawReq('POST', '/api/auth/logout')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy()
  })

  it('responds 204 to OPTIONS preflight', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/tasks', {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173' },
      }),
      env
    )
    expect(res.status).toBe(204)
  })

  it('sets Access-Control-Allow-Credentials', async () => {
    const res = await rawReq('POST', '/api/auth/logout')
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
  })
})

// ─── 404 fallback ─────────────────────────────────────────────────────────────

describe('API 404 fallback', () => {
  it('returns NOT_FOUND for unknown /api/* routes', async () => {
    const user = await createUser(env.DB, env)
    const { status, body } = await req('GET', '/api/nonexistent/route', env, { token: user.token })
    expect(status).toBe(404)
    expect((body as any).error.code).toBe('NOT_FOUND')
  })
})
