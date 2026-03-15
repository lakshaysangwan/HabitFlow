/**
 * PBKDF2-based password hashing using Web Crypto API (crypto.subtle).
 * Hardware-accelerated, works within Cloudflare Workers' CPU time limits.
 * Format: base64(salt):base64(hash)
 */

const ITERATIONS = 100_000
const KEY_LENGTH = 32 // bytes
const SALT_LENGTH = 16 // bytes

function bufferToBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

function base64ToBuffer(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const hashBuf = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_LENGTH * 8
  )
  return `${bufferToBase64(salt.buffer)}:${bufferToBase64(hashBuf)}`
}

export async function verifyPassword(stored: string, candidate: string): Promise<boolean> {
  const [saltB64, hashB64] = stored.split(':')
  if (!saltB64 || !hashB64) return false

  const salt = base64ToBuffer(saltB64)
  const expectedHash = base64ToBuffer(hashB64)

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(candidate),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const candidateHashBuf = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_LENGTH * 8
  )
  const candidateHash = new Uint8Array(candidateHashBuf)

  // Constant-time comparison
  if (candidateHash.length !== expectedHash.length) return false
  let diff = 0
  for (let i = 0; i < candidateHash.length; i++) {
    diff |= candidateHash[i] ^ expectedHash[i]
  }
  return diff === 0
}
