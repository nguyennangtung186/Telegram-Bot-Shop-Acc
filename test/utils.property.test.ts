import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { generateTransferCode } from '../src/utils/transfer-code'
import { isAdmin } from '../src/utils/admin'
import { generateVietQRUrl } from '../src/utils/vietqr'

/**
 * Property-based tests cho utility functions.
 * Validates: Requirements 2.4, 8.6, 2.2
 */

describe('Property 6: Transfer code format và uniqueness', () => {
  /**
   * **Validates: Requirements 2.4**
   * generateTransferCode luôn tạo string 6-20 chars, prefix NAP, chỉ chứa [A-Z0-9].
   */
  it('generates string matching /^NAP[A-Z0-9]{4,17}$/ with length 6-20', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2_000_000_000 }),
        (userId) => {
          const code = generateTransferCode(userId)

          // Length between 6 and 20
          expect(code.length).toBeGreaterThanOrEqual(6)
          expect(code.length).toBeLessThanOrEqual(20)

          // Matches format: NAP prefix + 4-17 alphanumeric uppercase chars
          expect(code).toMatch(/^NAP[A-Z0-9]{4,17}$/)
        }
      ),
      { numRuns: 200 }
    )
  })

  /**
   * **Validates: Requirements 2.4**
   * Hai lần gọi generateTransferCode với cùng userId tạo kết quả khác nhau (high probability).
   */
  it('produces different results for two calls with same userId', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2_000_000_000 }),
        (userId) => {
          const code1 = generateTransferCode(userId)
          const code2 = generateTransferCode(userId)

          // Random part ensures uniqueness with overwhelming probability
          expect(code1).not.toBe(code2)
        }
      ),
      { numRuns: 100 }
    )
  })
})

describe('Property 15: Admin ID check', () => {
  /**
   * **Validates: Requirements 8.6**
   * isAdmin trả về true khi telegram_id nằm trong ADMIN_IDS, false khi không.
   */
  it('returns true when telegramId is in the comma-separated list', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 2_000_000_000 }), { minLength: 1, maxLength: 10 }),
        fc.nat({ max: 9 }),
        (ids, indexSeed) => {
          const index = indexSeed % ids.length
          const targetId = ids[index]
          const adminIdsStr = ids.join(',')

          expect(isAdmin(targetId, adminIdsStr)).toBe(true)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('returns false when telegramId is NOT in the list', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 1_000_001, max: 2_000_000_000 }),
        (ids, outsiderId) => {
          const adminIdsStr = ids.join(',')

          // outsiderId is guaranteed to not be in ids (different range)
          expect(isAdmin(outsiderId, adminIdsStr)).toBe(false)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('returns false for empty or whitespace-only ADMIN_IDS', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2_000_000_000 }),
        fc.constantFrom('', ' ', '  ', ',', ',,'),
        (telegramId, emptyAdminIds) => {
          expect(isAdmin(telegramId, emptyAdminIds)).toBe(false)
        }
      ),
      { numRuns: 50 }
    )
  })
})

describe('Property 20: VietQR URL generation', () => {
  /**
   * **Validates: Requirements 2.2**
   * URL chứa bankId, accountNo, amount, và description.
   */
  it('generated URL contains bankId, accountNo, amount, and description', () => {
    fc.assert(
      fc.property(
        fc.record({
          bankId: fc.stringMatching(/^[A-Z]{2,10}$/),
          accountNo: fc.stringMatching(/^[0-9]{6,20}$/),
          accountName: fc.string({ minLength: 1, maxLength: 50 }),
          amount: fc.integer({ min: 20000, max: 100_000_000 }),
          description: fc.stringMatching(/^NAP[A-Z0-9]{4,17}$/),
        }),
        (params) => {
          const url = generateVietQRUrl(params)

          // URL contains base vietqr domain
          expect(url).toContain('https://img.vietqr.io/image/')

          // URL contains bankId and accountNo in path
          expect(url).toContain(params.bankId)
          expect(url).toContain(params.accountNo)

          // URL contains amount as query param
          expect(url).toContain(`amount=${params.amount}`)

          // URL contains description (addInfo param)
          expect(url).toContain(params.description)
        }
      ),
      { numRuns: 200 }
    )
  })
})
