/**
 * Deposit Expiry Service
 *
 * Hết hạn các deposits ở trạng thái "pending" quá {@link DEPOSIT_TTL_MS} (15 phút).
 * Được gọi từ scheduled handler (cron trigger mỗi 15 phút).
 *
 * Lưu ý: cron chỉ là bước DỌN DẸP để cập nhật trạng thái hiển thị. Tính đúng đắn nghiệp
 * vụ (đếm slot pending, cộng tiền webhook) đã được đảm bảo bằng so sánh thời gian theo
 * `created_at` ở `deposit-policy.ts` và `routes/sepay.ts`, nên độ trễ của cron không ảnh
 * hưởng kết quả.
 *
 * Requirements: 2.11
 */

import { DEPOSIT_TTL_MS } from './deposit-policy'

/**
 * Cập nhật tất cả deposits pending quá hạn TTL thành 'expired'.
 *
 * So sánh tuổi qua `strftime('%s', …)` để chuẩn hoá định dạng timestamp (ISO `…T…Z`
 * ở production lẫn `datetime('now')` dạng có dấu cách) về epoch giây UTC.
 *
 * @param db - D1Database instance
 * @returns Số lượng deposits đã bị expire
 */
export async function expirePendingDeposits(db: D1Database): Promise<number> {
  const now = new Date().toISOString()
  const ttlSec = DEPOSIT_TTL_MS / 1000

  const result = await db
    .prepare(
      `UPDATE deposits SET status = 'expired', expired_at = ?
       WHERE status = 'pending'
         AND strftime('%s','now') - strftime('%s', created_at) >= ?`
    )
    .bind(now, ttlSec)
    .run()

  return result.meta.changes
}
