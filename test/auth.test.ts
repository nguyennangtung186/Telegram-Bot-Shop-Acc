import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../src/utils/auth'

describe('auth utilities', () => {
  describe('hashPassword', () => {
    it('should return a bcrypt hash string', async () => {
      const hash = await hashPassword('mySecret123')
      expect(hash).toMatch(/^\$2[aby]?\$10\$/)
    })

    it('should produce different hashes for same password (salt)', async () => {
      const hash1 = await hashPassword('same')
      const hash2 = await hashPassword('same')
      expect(hash1).not.toBe(hash2)
    })
  })

  describe('verifyPassword', () => {
    it('should return true for matching password', async () => {
      const hash = await hashPassword('correct')
      const result = await verifyPassword('correct', hash)
      expect(result).toBe(true)
    })

    it('should return false for wrong password', async () => {
      const hash = await hashPassword('correct')
      const result = await verifyPassword('wrong', hash)
      expect(result).toBe(false)
    })
  })
})
