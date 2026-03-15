import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import { signJWT, verifyJWT, shouldRefresh, makeTokenCookie, clearTokenCookie } from '../../functions/lib/jwt'
import type { JWTPayload } from '../../functions/lib/jwt'

const TEST_PAYLOAD: JWTPayload = {
  sub: 'user123',
  username: 'alice',
  is_god: 0,
  token_version: 1,
}

describe('signJWT / verifyJWT', () => {
  it('signs and verifies a valid token', async () => {
    const token = await signJWT(TEST_PAYLOAD, env)
    expect(typeof token).toBe('string')
    expect(token.split('.')).toHaveLength(3) // JWT has 3 parts

    const payload = await verifyJWT(token, env)
    expect(payload).not.toBeNull()
    expect(payload!.sub).toBe('user123')
    expect(payload!.username).toBe('alice')
    expect(payload!.is_god).toBe(0)
    expect(payload!.token_version).toBe(1)
  })

  it('returns null for a tampered token', async () => {
    const token = await signJWT(TEST_PAYLOAD, env)
    const parts = token.split('.')
    // Flip a character in the signature
    parts[2] = parts[2].slice(0, -1) + (parts[2].endsWith('A') ? 'B' : 'A')
    const tampered = parts.join('.')
    expect(await verifyJWT(tampered, env)).toBeNull()
  })

  it('returns null for a token signed with a different secret', async () => {
    const otherToken = await signJWT(TEST_PAYLOAD, { JWT_SECRET: 'a-completely-different-secret-xyz' })
    expect(await verifyJWT(otherToken, env)).toBeNull()
  })

  it('returns null for a garbage string', async () => {
    expect(await verifyJWT('notavalidjwt', env)).toBeNull()
    expect(await verifyJWT('', env)).toBeNull()
  })

  it('includes exp and iat in payload', async () => {
    const token = await signJWT(TEST_PAYLOAD, env)
    const payload = await verifyJWT(token, env)
    expect(payload!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
    expect(payload!.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 1)
  })
})

describe('shouldRefresh', () => {
  it('returns false when token has more than 2 hours remaining', () => {
    const payload: JWTPayload = {
      ...TEST_PAYLOAD,
      exp: Math.floor(Date.now() / 1000) + 3 * 60 * 60, // 3 hours from now
    }
    expect(shouldRefresh(payload)).toBe(false)
  })

  it('returns true when token expires within 2 hours', () => {
    const payload: JWTPayload = {
      ...TEST_PAYLOAD,
      exp: Math.floor(Date.now() / 1000) + 60 * 60, // 1 hour from now
    }
    expect(shouldRefresh(payload)).toBe(true)
  })

  it('returns true for already-expired token', () => {
    const payload: JWTPayload = {
      ...TEST_PAYLOAD,
      exp: Math.floor(Date.now() / 1000) - 100,
    }
    expect(shouldRefresh(payload)).toBe(true)
  })

  it('returns false when exp is missing', () => {
    expect(shouldRefresh({ ...TEST_PAYLOAD })).toBe(false)
  })
})

describe('makeTokenCookie', () => {
  it('includes HttpOnly, SameSite=Strict, Path=/', () => {
    const cookie = makeTokenCookie('mytoken', { ENVIRONMENT: 'production' })
    expect(cookie).toContain('token=mytoken')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=86400')
  })

  it('includes Secure flag in production', () => {
    const cookie = makeTokenCookie('t', { ENVIRONMENT: 'production' })
    expect(cookie).toContain('Secure')
  })

  it('omits Secure flag in preview', () => {
    const cookie = makeTokenCookie('t', { ENVIRONMENT: 'preview' })
    expect(cookie).not.toContain('Secure')
  })
})

describe('clearTokenCookie', () => {
  it('sets Max-Age=0 to clear the cookie', () => {
    const cookie = clearTokenCookie()
    expect(cookie).toContain('Max-Age=0')
    expect(cookie).toContain('token=')
    expect(cookie).toContain('HttpOnly')
  })
})
