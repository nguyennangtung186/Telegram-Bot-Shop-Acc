/**
 * Session Manager — quản lý trạng thái flow nhập liệu cho users.
 *
 * In-memory Map<userId, UserSession> — chấp nhận được vì:
 * - Flow ngắn (< 5 phút)
 * - Telegram webhook luôn route qua cùng Worker instance
 * - Auto-expire sau 5 phút không activity
 *
 * @module bot/session
 * @requirements 9.4
 */

const SESSION_TIMEOUT_MS = 5 * 60 * 1000 // 5 phút

export type FlowType =
  | 'deposit'
  | 'purchase'
  | 'admin_add_type'
  | 'admin_edit_type'
  | 'admin_add_product'

export interface UserSession {
  userId: number
  flow: FlowType | null
  step: string | null
  data: Record<string, any>
  expiresAt: number // Unix timestamp (ms)
}

const sessions = new Map<number, UserSession>()

/**
 * Kiểm tra session đã hết hạn chưa.
 */
export function isSessionExpired(session: UserSession): boolean {
  return Date.now() > session.expiresAt
}

/**
 * Lấy session của user. Trả về null nếu không tồn tại hoặc đã hết hạn.
 * Auto-clean session hết hạn.
 */
export function getSession(userId: number): UserSession | null {
  const session = sessions.get(userId)
  if (!session) return null

  if (isSessionExpired(session)) {
    sessions.delete(userId)
    return null
  }

  return session
}

/**
 * Tạo hoặc cập nhật session cho user.
 * Reset expiresAt = now + 5 phút mỗi lần gọi.
 */
export function setSession(
  userId: number,
  flow: FlowType | null,
  step: string | null,
  data: Record<string, any> = {}
): UserSession {
  const session: UserSession = {
    userId,
    flow,
    step,
    data,
    expiresAt: Date.now() + SESSION_TIMEOUT_MS,
  }
  sessions.set(userId, session)
  return session
}

/**
 * Xoá session của user.
 */
export function clearSession(userId: number): void {
  sessions.delete(userId)
}

/**
 * Xoá tất cả sessions đã hết hạn.
 * Có thể gọi định kỳ để dọn dẹp memory.
 */
export function cleanExpiredSessions(): number {
  const now = Date.now()
  let cleaned = 0
  for (const [userId, session] of sessions) {
    if (now > session.expiresAt) {
      sessions.delete(userId)
      cleaned++
    }
  }
  return cleaned
}

/**
 * Lấy số lượng sessions đang active (chưa hết hạn).
 * Utility cho debugging/monitoring.
 */
export function getActiveSessionCount(): number {
  const now = Date.now()
  let count = 0
  for (const session of sessions.values()) {
    if (now <= session.expiresAt) count++
  }
  return count
}

/**
 * Reset toàn bộ sessions — chỉ dùng cho testing.
 */
export function _resetAllSessions(): void {
  sessions.clear()
}
