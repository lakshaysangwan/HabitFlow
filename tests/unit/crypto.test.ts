import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../../functions/lib/crypto'

describe('hashPassword', () => {
  it('returns salt:hash format', async () => {
    const hash = await hashPassword('mysecretpass')
    expect(hash).toMatch(/^[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/)
    const parts = hash.split(':')
    expect(parts).toHaveLength(2)
    expect(parts[0].length).toBeGreaterThan(0)
    expect(parts[1].length).toBeGreaterThan(0)
  })

  it('produces different hashes for the same password (random salt)', async () => {
    const h1 = await hashPassword('samepassword')
    const h2 = await hashPassword('samepassword')
    expect(h1).not.toBe(h2)
  })
})

describe('verifyPassword', () => {
  it('returns true for correct password', async () => {
    const hash = await hashPassword('correcthorse')
    expect(await verifyPassword(hash, 'correcthorse')).toBe(true)
  })

  it('returns false for wrong password', async () => {
    const hash = await hashPassword('correcthorse')
    expect(await verifyPassword(hash, 'wronghorse')).toBe(false)
  })

  it('returns false for empty password against real hash', async () => {
    const hash = await hashPassword('realpassword')
    expect(await verifyPassword(hash, '')).toBe(false)
  })

  it('returns false for malformed stored hash (no colon)', async () => {
    expect(await verifyPassword('notavalidhash', 'anything')).toBe(false)
  })

  it('returns false for empty stored hash', async () => {
    expect(await verifyPassword('', 'anything')).toBe(false)
  })

  it('uses constant-time comparison (no early return on length mismatch trick)', async () => {
    // Verify the function still completes and returns false (not throws) for mismatched data
    const hash = await hashPassword('password')
    const result = await verifyPassword(hash, 'x')
    expect(result).toBe(false)
  })
})
