// Feature: telegram-mini-app, Property 3
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { isInitDataFresh } from '../src/utils/telegram-initdata'

/**
 * Property 3: TTL chống replay.
 *
 * **Validates: Requirements 2.2, 2.4**
 *
 * `isInitDataFresh(authDate, ttlSeconds, nowSeconds)` chấp nhận (trả `true`)
 * KHI VÀ CHỈ KHI khoảng cách thời gian `now - authDate` nằm trong đoạn `[0, TTL]`.
 * Hàm là pure — không cần DB.
 *
 * Feature: telegram-mini-app, Property 3
 */
describe('Property 3: TTL chống replay', () => {
  // Bounds hợp lý: epoch seconds ~ tới năm 2033; TTL 0..1 ngày.
  const authDateArb = fc.integer({ min: 0, max: 2_000_000_000 })
  const ttlArb = fc.integer({ min: 0, max: 86_400 })

  /**
   * Bất biến iff với now và authDate sinh độc lập (bao phủ rộng vùng false).
   */
  it('returns true iff (now - authDate) ∈ [0, ttl] for independent inputs', () => {
    fc.assert(
      fc.property(
        authDateArb,
        ttlArb,
        fc.integer({ min: 0, max: 2_000_000_000 }),
        (authDate, ttlSeconds, nowSeconds) => {
          const diff = nowSeconds - authDate
          const expected = diff >= 0 && diff <= ttlSeconds
          expect(isInitDataFresh(authDate, ttlSeconds, nowSeconds)).toBe(expected)
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * Bất biến iff với now = authDate + delta để bao phủ dày vùng true
   * và sát hai biên của cửa sổ TTL.
   */
  it('returns true iff delta ∈ [0, ttl] when now = authDate + delta', () => {
    fc.assert(
      fc.property(
        authDateArb,
        ttlArb,
        fc.integer({ min: -100, max: 100_000 }),
        (authDate, ttlSeconds, delta) => {
          const nowSeconds = authDate + delta
          const expected = delta >= 0 && delta <= ttlSeconds
          expect(isInitDataFresh(authDate, ttlSeconds, nowSeconds)).toBe(expected)
        }
      ),
      { numRuns: 100 }
    )
  })

  // --- Boundary cases (ví dụ tường minh) ---

  it('accepts when now == authDate (diff = 0)', () => {
    fc.assert(
      fc.property(authDateArb, ttlArb, (authDate, ttlSeconds) => {
        expect(isInitDataFresh(authDate, ttlSeconds, authDate)).toBe(true)
      }),
      { numRuns: 100 }
    )
  })

  it('accepts when now - authDate == ttl exactly (upper boundary)', () => {
    fc.assert(
      fc.property(authDateArb, ttlArb, (authDate, ttlSeconds) => {
        const nowSeconds = authDate + ttlSeconds
        expect(isInitDataFresh(authDate, ttlSeconds, nowSeconds)).toBe(true)
      }),
      { numRuns: 100 }
    )
  })

  it('rejects when now - authDate == ttl + 1 (just past TTL)', () => {
    fc.assert(
      fc.property(authDateArb, ttlArb, (authDate, ttlSeconds) => {
        const nowSeconds = authDate + ttlSeconds + 1
        expect(isInitDataFresh(authDate, ttlSeconds, nowSeconds)).toBe(false)
      }),
      { numRuns: 100 }
    )
  })

  it('rejects when now < authDate (clock-skew / replay from the future)', () => {
    fc.assert(
      fc.property(
        authDateArb,
        ttlArb,
        fc.integer({ min: 1, max: 1_000_000 }),
        (authDate, ttlSeconds, behind) => {
          const nowSeconds = authDate - behind
          expect(isInitDataFresh(authDate, ttlSeconds, nowSeconds)).toBe(false)
        }
      ),
      { numRuns: 100 }
    )
  })
})
