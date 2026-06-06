/**
 * Rate Limiter — chống spam ở tầng bot (token bucket in-memory).
 *
 * Cùng triết lý với `session.ts`: state in-memory Map<key, ...> — chấp nhận được vì:
 * - Spam từ một user là chuỗi request liên tiếp → gần như luôn rơi vào cùng một
 *   warm isolate trong cùng colo Cloudflare, nên đếm in-memory hiệu quả thực tế cao.
 * - Chi phí khi "miss" (isolate bị evict / chạy song song nhiều isolate) chỉ là vài
 *   request spam lọt qua — không gây hậu quả tài chính (đã có CHECK balance + atomic batch).
 * - Không tạo thêm tải D1/KV cho mỗi update (rate-limit mà ghi DB mỗi lần thì tự nó là tải).
 *
 * Nếu sau này cần đảm bảo cross-isolate tuyệt đối → nâng cấp sang Durable Object
 * hoặc Workers Rate Limiting binding. Hiện tại in-memory là đủ và đúng kiến trúc.
 *
 * @module bot/rate-limit
 */

/** Một luật giới hạn theo thuật toán token bucket. */
export interface RateLimitRule {
  /** Số token tối đa trong bucket (cho phép burst tối đa bằng giá trị này). */
  capacity: number
  /** Tốc độ hồi token mỗi giây (xác định throughput bền vững). */
  refillPerSec: number
}

/** Kết quả khi tiêu thụ một token. */
export interface RateLimitResult {
  /** Cho phép xử lý request hay không. */
  allowed: boolean
  /** Số token còn lại (làm tròn xuống). */
  remaining: number
  /** Thời gian (ms) cần chờ tới khi có đủ 1 token (0 nếu allowed). */
  retryAfterMs: number
}

// --- Các luật chuẩn (named constants, không hardcode rải rác) ---

/**
 * Flood toàn cục cho mọi update của một user.
 * Burst 12 (đủ để điều hướng menu sinh nhiều callback liên tiếp),
 * bền vững 2 thao tác/giây — chặn mash nút/gõ liên tục.
 */
export const FLOOD_RULE: RateLimitRule = { capacity: 12, refillPerSec: 2 }

/**
 * Xác nhận mua hàng — thao tác chạy giao dịch atomic, nhạy cảm tài chính.
 * Burst 5, bền vững 1 lần / 5 giây.
 */
export const PURCHASE_RULE: RateLimitRule = { capacity: 5, refillPerSec: 0.2 }

/** Khoảng thời gian tối thiểu giữa 2 lần báo "chậm lại" cho cùng một key (ms). */
export const NOTICE_COOLDOWN_MS = 5_000

/** Khi số bucket vượt ngưỡng này → quét dọn các bucket nhàn rỗi. */
const CLEANUP_THRESHOLD = 10_000

/** Bucket đầy và không chạm tới trong khoảng này (ms) được coi là rác → xoá. */
const IDLE_TTL_MS = 10 * 60 * 1000 // 10 phút

// --- State in-memory ---

interface Bucket {
  tokens: number
  lastRefill: number
}

const buckets = new Map<string, Bucket>()
const notices = new Map<string, number>()

// --- Core: token bucket ---

/**
 * Tiêu thụ 1 token cho `key` theo `rule`.
 * `now` cho phép inject thời gian để test xác định (mặc định Date.now()).
 */
export function consumeToken(
  key: string,
  rule: RateLimitRule,
  now: number = Date.now()
): RateLimitResult {
  maybeCleanup(now)

  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = { tokens: rule.capacity, lastRefill: now }
    buckets.set(key, bucket)
  }

  // Hồi token theo thời gian đã trôi qua.
  const elapsedSec = (now - bucket.lastRefill) / 1000
  if (elapsedSec > 0) {
    bucket.tokens = Math.min(rule.capacity, bucket.tokens + elapsedSec * rule.refillPerSec)
    bucket.lastRefill = now
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1
    return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 }
  }

  // Không đủ token → tính thời gian chờ tới khi hồi đủ phần còn thiếu.
  const deficit = 1 - bucket.tokens
  const retryAfterMs = Math.ceil((deficit / rule.refillPerSec) * 1000)
  return { allowed: false, remaining: 0, retryAfterMs }
}

// --- Notice throttle: tránh bot spam ngược lại user ---

/**
 * Trả về true nếu được phép gửi thông báo "chậm lại" cho `key` lúc này.
 * Mỗi lần trả true sẽ ghi lại mốc thời gian, các lần gọi trong `cooldownMs` tiếp theo trả false.
 */
export function shouldSendNotice(
  key: string,
  now: number = Date.now(),
  cooldownMs: number = NOTICE_COOLDOWN_MS
): boolean {
  const last = notices.get(key) ?? 0
  if (now - last >= cooldownMs) {
    notices.set(key, now)
    return true
  }
  return false
}

// --- Tiện ích ---

/** Quy đổi ms → số giây (làm tròn lên), tối thiểu 1 — dùng cho thông báo người dùng. */
export function retryAfterSeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000))
}

/**
 * Quét dọn các bucket đầy + nhàn rỗi và các notice quá hạn để tránh rò rỉ bộ nhớ.
 * Trả về số mục đã xoá.
 */
export function cleanupStaleEntries(now: number = Date.now()): number {
  let removed = 0

  for (const [key, bucket] of buckets) {
    const idleMs = now - bucket.lastRefill
    // Chỉ xoá bucket đã hồi đầy (không đang bị giới hạn) và lâu không dùng.
    if (idleMs >= IDLE_TTL_MS) {
      buckets.delete(key)
      removed++
    }
  }

  for (const [key, last] of notices) {
    if (now - last >= IDLE_TTL_MS) {
      notices.delete(key)
      removed++
    }
  }

  return removed
}

/** Quét dọn cơ hội khi map phình to (gọi nội bộ trong consumeToken). */
function maybeCleanup(now: number): void {
  if (buckets.size > CLEANUP_THRESHOLD) {
    cleanupStaleEntries(now)
  }
}

/** Số bucket đang giữ — phục vụ debug/monitoring. */
export function getBucketCount(): number {
  return buckets.size
}

/** Reset toàn bộ state — chỉ dùng cho testing. */
export function _resetRateLimiter(): void {
  buckets.clear()
  notices.clear()
}
