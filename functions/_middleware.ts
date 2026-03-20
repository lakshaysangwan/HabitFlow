/**
 * Cloudflare Pages Functions middleware.
 * Runs on every request before route handlers.
 *
 * Responsibilities:
 * 1. Add security headers to all responses
 * 2. Set CORS headers
 *
 * Auth (JWT verification, token_version check, sliding-window refresh)
 * is handled entirely by the Hono app in api/app.ts to avoid doing it twice.
 */

import { SECURITY_HEADERS } from './lib/response'
import type { Env } from './lib/env'

interface PagesContext {
  request: Request
  env: Env
  next: () => Promise<Response>
  data: Record<string, unknown>
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env, next } = context
  const url = new URL(request.url)

  // Handle CORS preflight (fast path — no need to hit route handlers)
  if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request, env),
    })
  }

  const response = await next()

  // Apply security + CORS headers to every response
  const headers = new Headers(response.headers)
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    headers.set(k, v)
  }
  const cors = corsHeaders(request, env)
  for (const [k, v] of Object.entries(Object.fromEntries(cors.entries()))) {
    headers.set(k, v)
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
