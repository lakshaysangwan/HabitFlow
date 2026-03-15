/**
 * Cloudflare Pages Functions catch-all — routes all /api/* requests through Hono.
 *
 * This file handles every request to /api/* by delegating to the Hono app.
 * Auth/middleware validation is done in functions/_middleware.ts (runs first).
 */

/// <reference types="@cloudflare/workers-types" />
import type { Env } from '../lib/env'
import { createApp } from './app'

const app = createApp()

export const onRequest: PagesFunction<Env> = (context) => {
  return app.fetch(context.request, context.env)
}
