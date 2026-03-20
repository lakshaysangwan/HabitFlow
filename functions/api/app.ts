/**
 * Hono app factory — importable by tests without the [[catchall]] filename.
 * The Pages Function catch-all wraps this via onRequest.
 */

import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { Env } from '../lib/env'
import { SECURITY_HEADERS } from '../lib/response'
import { verifyJWT, signJWT, shouldRefresh, makeTokenCookie } from '../lib/jwt'
import { getDB, schema } from '../lib/db'
import { checkTokenCache, setTokenCache } from '../lib/token-cache'

import { app as authRoutes } from './routes/auth'
import { app as tasksRoutes } from './routes/tasks'
import { app as completionsRoutes } from './routes/completions'
import { app as analyticsRoutes } from './routes/analytics'
import { app as adminRoutes } from './routes/admin'

// Routes that skip JWT auth
const PUBLIC_PATHS = ['/api/auth/login', '/api/auth/logout']

type Variables = { userId: string; is_god: number }

function getCorsOrigin(request: Request, env: Env): string {
  const origin = request.headers.get('Origin') ?? ''
  const prod = env.ALLOWED_ORIGIN ?? 'https://habitflow.pages.dev'
  return env.ENVIRONMENT === 'preview' ? (origin || prod) : prod
}

export function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>().basePath('/api')

  // OPTIONS preflight
  app.options('*', (c) => {
    const origin = getCorsOrigin(c.req.raw, c.env)
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
      },
    })
  })

  // Security + CORS headers on every response
  app.use('*', async (c, next) => {
    await next()
    const origin = getCorsOrigin(c.req.raw, c.env)
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      c.res.headers.set(k, v)
    }
    c.res.headers.set('Access-Control-Allow-Origin', origin)
    c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS')
    c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type')
    c.res.headers.set('Access-Control-Allow-Credentials', 'true')
  })

  // JWT auth middleware — handles TOKEN_MISSING, TOKEN_INVALID, TOKEN_REVOKED
  app.use('*', async (c, next) => {
    const path = new URL(c.req.url).pathname
    if (PUBLIC_PATHS.some(p => path === p || path.startsWith(p + '/'))) {
      return next()
    }

    const cookieHeader = c.req.header('Cookie') ?? ''
    const tokenMatch = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/)
    const token = tokenMatch?.[1]

    if (!token) {
      return c.json({ ok: false, error: { code: 'TOKEN_MISSING', message: 'Authentication required' } }, 401)
    }

    const payload = await verifyJWT(token, c.env)
    if (!payload) {
      return c.json({ ok: false, error: { code: 'TOKEN_INVALID', message: 'Invalid or expired session' } }, 401)
    }

    // Token revocation check via token_version (cache-first, DB fallback)
    const cached = checkTokenCache(payload.sub, payload.token_version)
    if (cached === false) {
      return c.json({ ok: false, error: { code: 'TOKEN_REVOKED', message: 'Session was invalidated. Please log in again.' } }, 401)
    }
    if (cached === null) {
      // Cache miss — query DB and update cache
      const db = getDB(c.env.DB)
      const user = await db
        .select({ token_version: schema.users.token_version })
        .from(schema.users)
        .where(eq(schema.users.id, payload.sub))
        .get()

      if (!user || user.token_version !== payload.token_version) {
        return c.json({ ok: false, error: { code: 'TOKEN_REVOKED', message: 'Session was invalidated. Please log in again.' } }, 401)
      }
      setTokenCache(payload.sub, user.token_version)
    }

    c.set('userId', payload.sub)
    c.set('is_god', payload.is_god)
    await next()

    // Sliding-window token refresh: issue a new token if expiry is within 2h
    if (shouldRefresh(payload)) {
      const newToken = await signJWT(payload, c.env)
      c.res.headers.append('Set-Cookie', makeTokenCookie(newToken, c.env))
    }
  })

  app.route('/auth', authRoutes)
  app.route('/tasks', tasksRoutes)
  app.route('/completions', completionsRoutes)
  app.route('/analytics', analyticsRoutes)
  app.route('/admin', adminRoutes)

  app.all('*', (c) =>
    c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'API route not found' } }, 404)
  )

  return app
}
