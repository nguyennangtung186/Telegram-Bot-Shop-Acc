import { describe, it, expect, beforeEach } from 'vitest'
import {
  consumeToken,
  shouldSendNotice,
  retryAfterSeconds,
  cleanupStaleEntries,
  getBucketCount,
  _resetRateLimiter,
  FLOOD_RULE,
  PURCHASE_RULE,
  NOTICE_COOLDOWN_MS,
  type RateLimitRule,
} from '../src/bot/rate-limit'

beforeEach(() => {
  _resetRateLimiter()
})

describe('consumeToken — token bucket cơ bản', () => {
  const rule: RateLimitRule = { capacity: 3, refillPerSec: 1 }

  it('cho phép burst đúng bằng capacity rồi chặn request kế tiếp', () => {
    const t0 = 1_000_000
    // 3 token đầu phải pass (không hồi token vì cùng mốc thời gian).
    expect(consumeToken('u1', rule, t0).allowed).toBe(true)
    expect(consumeToken('u1', rule, t0).allowed).toBe(true)
    expect(consumeToken('u1', rule, t0).allowed).toBe(true)

    const blocked = consumeToken('u1', rule, t0)
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
  })

  it('remaining giảm dần theo từng lần tiêu thụ', () => {
    const t0 = 2_000_000
    expect(consumeToken('u2', rule, t0).remaining).toBe(2)
    expect(consumeToken('u2', rule, t0).remaining).toBe(1)
    expect(consumeToken('u2', rule, t0).remaining).toBe(0)
  })

  it('hồi token theo thời gian trôi qua', () => {
    const t0 = 3_000_000
    // Xài hết 3 token.
    consumeToken('u3', rule, t0)
    consumeToken('u3', rule, t0)
    consumeToken('u3', rule, t0)
    expect(consumeToken('u3', rule, t0).allowed).toBe(false)

    // Sau 1 giây → hồi đúng 1 token → 1 request pass, request kế bị chặn.
    const after1s = t0 + 1000
    expect(consumeToken('u3', rule, after1s).allowed).toBe(true)
    expect(consumeToken('u3', rule, after1s).allowed).toBe(false)
  })

  it('không hồi vượt quá capacity (không tích luỹ vô hạn)', () => {
    const t0 = 4_000_000
    consumeToken('u4', rule, t0) // dùng 1, còn 2
    // Chờ rất lâu → vẫn chỉ đầy tối đa capacity=3.
    const farFuture = t0 + 1_000_000
    expect(consumeToken('u4', rule, farFuture).remaining).toBe(2)
    expect(consumeToken('u4', rule, farFuture).remaining).toBe(1)
    expect(consumeToken('u4', rule, farFuture).remaining).toBe(0)
    expect(consumeToken('u4', rule, farFuture).allowed).toBe(false)
  })

  it('retryAfterMs khớp với tốc độ hồi token', () => {
    const slow: RateLimitRule = { capacity: 1, refillPerSec: 0.1 } // 1 token / 10s
    const t0 = 5_000_000
    expect(consumeToken('u5', slow, t0).allowed).toBe(true)
    const blocked = consumeToken('u5', slow, t0)
    expect(blocked.allowed).toBe(false)
    // Thiếu 1 token, hồi 0.1/s → ~10000ms.
    expect(blocked.retryAfterMs).toBe(10_000)
  })

  it('các key độc lập với nhau', () => {
    const t0 = 6_000_000
    consumeToken('a', rule, t0)
    consumeToken('a', rule, t0)
    consumeToken('a', rule, t0)
    expect(consumeToken('a', rule, t0).allowed).toBe(false)
    // key 'b' không bị ảnh hưởng.
    expect(consumeToken('b', rule, t0).allowed).toBe(true)
  })
})

describe('Các luật cấu hình sẵn', () => {
  it('FLOOD_RULE cho burst 12 rồi chặn (mô phỏng mash nút)', () => {
    const t0 = 10_000_000
    for (let i = 0; i < FLOOD_RULE.capacity; i++) {
      expect(consumeToken('flood:1', FLOOD_RULE, t0).allowed).toBe(true)
    }
    expect(consumeToken('flood:1', FLOOD_RULE, t0).allowed).toBe(false)
  })

  it('PURCHASE_RULE chặn double-tap xác nhận mua trong cùng thời điểm', () => {
    const t0 = 11_000_000
    for (let i = 0; i < PURCHASE_RULE.capacity; i++) {
      expect(consumeToken('buy:1', PURCHASE_RULE, t0).allowed).toBe(true)
    }
    expect(consumeToken('buy:1', PURCHASE_RULE, t0).allowed).toBe(false)
  })
})

describe('shouldSendNotice — throttle thông báo', () => {
  it('lần đầu trả true, các lần trong cooldown trả false', () => {
    const t0 = 20_000_000
    expect(shouldSendNotice('n1', t0)).toBe(true)
    expect(shouldSendNotice('n1', t0 + 1000)).toBe(false)
    expect(shouldSendNotice('n1', t0 + NOTICE_COOLDOWN_MS - 1)).toBe(false)
  })

  it('sau khi hết cooldown lại cho phép gửi', () => {
    const t0 = 21_000_000
    expect(shouldSendNotice('n2', t0)).toBe(true)
    expect(shouldSendNotice('n2', t0 + NOTICE_COOLDOWN_MS)).toBe(true)
  })

  it('các key notice độc lập', () => {
    const t0 = 22_000_000
    expect(shouldSendNotice('x', t0)).toBe(true)
    expect(shouldSendNotice('y', t0)).toBe(true)
  })
})

describe('retryAfterSeconds', () => {
  it('làm tròn lên và tối thiểu 1', () => {
    expect(retryAfterSeconds(0)).toBe(1)
    expect(retryAfterSeconds(1)).toBe(1)
    expect(retryAfterSeconds(1000)).toBe(1)
    expect(retryAfterSeconds(1001)).toBe(2)
    expect(retryAfterSeconds(9500)).toBe(10)
  })
})

describe('cleanupStaleEntries', () => {
  it('xoá bucket nhàn rỗi quá lâu', () => {
    const t0 = 30_000_000
    consumeToken('old', FLOOD_RULE, t0)
    expect(getBucketCount()).toBe(1)

    // Quét ở thời điểm > IDLE_TTL (10 phút) sau lần dùng cuối.
    const removed = cleanupStaleEntries(t0 + 11 * 60 * 1000)
    expect(removed).toBeGreaterThanOrEqual(1)
    expect(getBucketCount()).toBe(0)
  })

  it('không xoá bucket vừa mới dùng', () => {
    const t0 = 31_000_000
    consumeToken('fresh', FLOOD_RULE, t0)
    const removed = cleanupStaleEntries(t0 + 1000)
    expect(removed).toBe(0)
    expect(getBucketCount()).toBe(1)
  })
})
