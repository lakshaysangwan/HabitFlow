/**
 * Cloudflare Pages Functions middleware.
 * Runs on every request to /api/* before route handlers.
 *
 * Responsibilities:
 * 1. Add security headers to all responses
 * 2. Set CORS headers
 * 3. JWT authentication (skip public routes)
 * 4. Token version validation (revocation check)
 * 5. Token sliding-window refresh
 */

import { verifyJWT, signJWT, shouldRefresh, makeTokenCookie } from './lib/jwt'
import { getDB, schema } from './lib/db'
import { eq } from 'drizzle-orm'
import { SECURITY_HEADERS } from './lib/response'
import type { Env } from './lib/env'

// Routes that don't require auth
const PUBLIC_ROUTES = ['/api/auth/login', '/api/auth/logout']

interface PagesContext {
  request: Request
  env: Env
  next: () => Promise<Response>
  data: Record<string, unknown>
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env, next, data } = context
  const url = new URL(request.url)

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request, env),
    })
  }

  // Only process /api/* routes
  if (!url.pathname.startsWith('/api/')) {
    return next()
  }

  const isPublic = PUBLIC_ROUTES.some(r => url.pathname === r || url.pathname.startsWith(r + '/'))

  // Parse JWT from cookie
  const cookieHeader = request.headers.get('Cookie') ?? ''
  const tokenMatch = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/)
  const token = tokenMatch?.[1]

  if (!isPublic) {
    if (!token) {
      return unauthorizedResponse('TOKEN_MISSING', 'Authentication required')
    }

    const payload = await verifyJWT(token, env)
    if (!payload) {
      return unauthorizedResponse('TOKEN_INVALID', 'Invalid or expired session')
    }

    // Validate token_version against DB (revocation check)
    const db = getDB(env.DB)
    const user = await db
      .select({ token_version: schema.users.token_version })
      .from(schema.users)
      .where(eq(schema.users.id, payload.sub))
      .get()

    if (!user || user.token_version !== payload.token_version) {
      return unauthorizedResponse('TOKEN_REVOKED', 'Your session was invalidated. Please log in again.')
    }

    // Attach user info to context for route handlers
    data.userId = payload.sub
    data.username = payload.username
    data.isGod = payload.is_god === 1
    data.tokenPayload = payload
  }

  const response = await next()

  // Apply security headers and CORS
  const headers = new Headers(response.headers)
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    headers.set(k, v)
  }
  const cors = corsHeaders(request, env)
  for (const [k, v] of Object.entries(Object.fromEntries(cors.entries()))) {
    headers.set(k, v)
  }

  // Sliding window token refresh
  if (!isPublic && token) {
    const payload = await verifyJWT(token, env)
    if (payload && shouldRefresh(payload)) {
      const newToken = await signJWT(payload, env)
      headers.append('Set-Cookie', makeTokenCookie(newToken, env))
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function corsHeaders(request: Request, env: Env): Headers {
  const origin = request.headers.get('Origin') ?? ''
  const prod = env.ALLOWED_ORIGIN ?? 'https://habitflow.pages.dev'
  const allowed = env.ENVIRONMENT === 'preview' ? origin : prod

  const headers = new Headers()
  headers.set('Access-Control-Allow-Origin', allowed || prod)
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type')
  headers.set('Access-Control-Allow-Credentials', 'true')
  return headers
}

function unauthorizedResponse(code: string, message: string): Response {
  return Response.json(
    { ok: false, error: { code, message } },
    { status: 401 }
  )
}
