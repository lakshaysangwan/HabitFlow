/** Standard API response helpers */

export function ok<T>(data: T, status = 200): Response {
  return Response.json({ ok: true, data }, { status })
}

export function err(code: string, message: string, status = 400): Response {
  return Response.json({ ok: false, error: { code, message } }, { status })
}

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-DNS-Prefetch-Control': 'off',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'none'",
}

export function addSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    headers.set(k, v)
  }
  return new Response(response.body, { status: response.status, headers })
}
