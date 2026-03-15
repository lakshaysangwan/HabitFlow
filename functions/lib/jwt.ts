import { SignJWT, jwtVerify } from 'jose'

export interface JWTPayload {
  sub: string        // user_id
  username: string
  is_god: number
  token_version: number
  iat?: number
  exp?: number
}

const ALG = 'HS256'
const EXPIRY = '24h'
const REFRESH_THRESHOLD = 2 * 60 * 60 // 2 hours in seconds

function getSecret(env: { JWT_SECRET: string }): Uint8Array {
  return new TextEncoder().encode(env.JWT_SECRET)
}

export async function signJWT(payload: JWTPayload, env: { JWT_SECRET: string }): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(getSecret(env))
}

export async function verifyJWT(
  token: string,
  env: { JWT_SECRET: string }
): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(env))
    return payload as unknown as JWTPayload
  } catch {
    return null
  }
}

/** Returns true if the token expires within REFRESH_THRESHOLD seconds */
export function shouldRefresh(payload: JWTPayload): boolean {
  if (!payload.exp) return false
  const now = Math.floor(Date.now() / 1000)
  return payload.exp - now < REFRESH_THRESHOLD
}

export function makeTokenCookie(token: string, env: { ENVIRONMENT?: string }): string {
  const secure = env.ENVIRONMENT !== 'preview' ? '; Secure' : ''
  return `token=${token}; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=86400`
}

export function clearTokenCookie(): string {
  return 'token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'
}
