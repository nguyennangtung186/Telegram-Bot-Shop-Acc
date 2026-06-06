import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { hashPassword, verifyPassword } from '../src/utils/auth'

/**
 * Property-based tests cho password hashing.
 * **Validates: Requirements 12.2**
 */

describe('Property 18: Password hash round-trip', () => {
  /**
   * **Validates: Requirements 12.2**
   * hashPassword + verifyPassword round-trip: verify đúng password luôn trả true.
   */
  it('verifyPassword returns true for the original password', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 72 }),
        async (password) => {
          const hash = await hashPassword(password)
          const result = await verifyPassword(password, hash)
          expect(result).toBe(true)
        }
      ),
      { numRuns: 20 }
    )
  })

  /**
   * **Validates: Requirements 12.2**
   * verifyPassword trả false cho password khác (wrong password).
   */
  it('verifyPassword returns false for a different password', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 72 }),
        fc.string({ minLength: 1, maxLength: 72 }),
        async (password, wrongPassword) => {
          fc.pre(password !== wrongPassword)

          const hash = await hashPassword(password)
          const result = await verifyPassword(wrongPassword, hash)
          expect(result).toBe(false)
        }
      ),
      { numRuns: 20 }
    )
  })

  /**
   * **Validates: Requirements 12.2**
   * hashPassword luôn tạo bcrypt-format string (starts with $2a$ or $2b$).
   */
  it('hashPassword produces a bcrypt-format string', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 72 }),
        async (password) => {
          const hash = await hashPassword(password)
          expect(hash).toMatch(/^\$2[ab]\$10\$.{53}$/)
        }
      ),
      { numRuns: 20 }
    )
  })

  /**
   * **Validates: Requirements 12.2**
   * Same password hashed twice produces different hashes (different salts).
   */
  it('same password hashed twice produces different hashes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 72 }),
        async (password) => {
          const hash1 = await hashPassword(password)
          const hash2 = await hashPassword(password)
          expect(hash1).not.toBe(hash2)
        }
      ),
      { numRuns: 20 }
    )
  })
})
