import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  getSession,
  setSession,
  clearSession,
  isSessionExpired,
  cleanExpiredSessions,
  getActiveSessionCount,
  _resetAllSessions,
  type UserSession,
} from '../src/bot/session'

describe('Session Manager', () => {
  beforeEach(() => {
    _resetAllSessions()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('setSession', () => {
    it('tạo session mới với expiresAt = now + 5 phút', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      const session = setSession(123, 'deposit', 'amount', { amount: 50000 })

      expect(session.userId).toBe(123)
      expect(session.flow).toBe('deposit')
      expect(session.step).toBe('amount')
      expect(session.data).toEqual({ amount: 50000 })
      expect(session.expiresAt).toBe(now + 5 * 60 * 1000)
    })

    it('ghi đè session cũ khi gọi lại với cùng userId', () => {
      setSession(123, 'deposit', 'amount', { amount: 50000 })
      const updated = setSession(123, 'admin_add_type', 'name', { name: 'Test' })

      expect(updated.flow).toBe('admin_add_type')
      expect(updated.step).toBe('name')
      expect(updated.data).toEqual({ name: 'Test' })
    })

    it('default data = {} khi không truyền', () => {
      const session = setSession(456, 'deposit', 'menu')
      expect(session.data).toEqual({})
    })
  })

  describe('getSession', () => {
    it('trả về session nếu tồn tại và chưa hết hạn', () => {
      setSession(123, 'deposit', 'amount', { x: 1 })
      const session = getSession(123)

      expect(session).not.toBeNull()
      expect(session!.userId).toBe(123)
      expect(session!.flow).toBe('deposit')
    })

    it('trả về null nếu userId không có session', () => {
      expect(getSession(999)).toBeNull()
    })

    it('trả về null và xoá session nếu đã hết hạn', () => {
      const now = Date.now()
      vi.setSystemTime(now)
      setSession(123, 'deposit', 'amount')

      // Advance time 5 phút + 1ms
      vi.setSystemTime(now + 5 * 60 * 1000 + 1)

      expect(getSession(123)).toBeNull()
      // Confirm session is cleaned
      vi.setSystemTime(now) // reset time
      expect(getSession(123)).toBeNull() // session đã bị xoá
    })
  })

  describe('clearSession', () => {
    it('xoá session của user', () => {
      setSession(123, 'deposit', 'amount')
      clearSession(123)
      expect(getSession(123)).toBeNull()
    })

    it('không throw nếu user không có session', () => {
      expect(() => clearSession(999)).not.toThrow()
    })
  })

  describe('isSessionExpired', () => {
    it('trả về false khi session chưa hết hạn', () => {
      const session: UserSession = {
        userId: 1,
        flow: 'deposit',
        step: 'amount',
        data: {},
        expiresAt: Date.now() + 60_000,
      }
      expect(isSessionExpired(session)).toBe(false)
    })

    it('trả về true khi session đã hết hạn', () => {
      const session: UserSession = {
        userId: 1,
        flow: 'deposit',
        step: 'amount',
        data: {},
        expiresAt: Date.now() - 1,
      }
      expect(isSessionExpired(session)).toBe(true)
    })
  })

  describe('cleanExpiredSessions', () => {
    it('xoá tất cả sessions hết hạn, giữ sessions còn sống', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      setSession(1, 'deposit', 'a')
      setSession(2, 'deposit', 'b')
      setSession(3, 'admin_add_type', 'c')

      // Advance 3 phút — tất cả còn sống
      vi.setSystemTime(now + 3 * 60 * 1000)
      setSession(4, 'admin_add_product', 'd') // session mới

      // Advance thêm 3 phút — sessions 1, 2, 3 hết hạn, session 4 còn sống
      vi.setSystemTime(now + 6 * 60 * 1000)

      const cleaned = cleanExpiredSessions()
      expect(cleaned).toBe(3)
      expect(getSession(1)).toBeNull()
      expect(getSession(2)).toBeNull()
      expect(getSession(3)).toBeNull()
      expect(getSession(4)).not.toBeNull()
    })
  })

  describe('getActiveSessionCount', () => {
    it('đếm đúng số sessions chưa hết hạn', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      setSession(1, 'deposit', 'a')
      setSession(2, 'deposit', 'b')
      expect(getActiveSessionCount()).toBe(2)

      // Expire sessions
      vi.setSystemTime(now + 6 * 60 * 1000)
      expect(getActiveSessionCount()).toBe(0)
    })
  })

  describe('Flow types', () => {
    it('hỗ trợ tất cả flow types', () => {
      setSession(1, 'deposit', 'step1')
      expect(getSession(1)!.flow).toBe('deposit')

      setSession(2, 'admin_add_type', 'step1')
      expect(getSession(2)!.flow).toBe('admin_add_type')

      setSession(3, 'admin_edit_type', 'step1')
      expect(getSession(3)!.flow).toBe('admin_edit_type')

      setSession(4, 'admin_add_product', 'step1')
      expect(getSession(4)!.flow).toBe('admin_add_product')
    })

    it('hỗ trợ flow = null (no active flow)', () => {
      setSession(1, null, null)
      expect(getSession(1)!.flow).toBeNull()
      expect(getSession(1)!.step).toBeNull()
    })
  })
})
