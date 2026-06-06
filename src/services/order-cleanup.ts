/**
 * Order Cleanup Service — dọn orphan order do giao dịch mua hàng dở dang để lại.
 *
 * Bối cảnh: `executePurchase` dùng two-phase (bắt buộc vì nhiều child rows cùng cần
 * `orderId`, mà `last_insert_rowid()` không dùng được cho nhiều child trong một batch):
 *   - Phase 1: INSERT order (status 'completed') để lấy `orderId`.
 *   - Phase 2: batch atomic — trừ tiền (guard) + đánh dấu products sold + order_items +
 *     transaction.
 *
 * Nếu Worker chết đúng khe giữa phase 1 (đã commit) và phase 2 (chưa chạy), order tồn tại
 * NHƯNG chưa trừ tiền, chưa có order_items/products/transaction nào trỏ tới → "orphan".
 * Orphan này status 'completed' nên LỌT vào tổng doanh thu (revenue sum theo
 * status='completed') gây thổi phồng số liệu.
 *
 * Dấu hiệu nhận diện chắc chắn: một purchase thành công LUÔN có >= 1 `order_items` (tạo
 * cùng batch phase 2, quantity >= 1). Order không có order_items nào ⇒ orphan.
 *
 * Cleanup chạy từ scheduled handler (cron 15 phút). Chốt chặn an toàn:
 *   - Chỉ xoá order quá {@link ORPHAN_MIN_AGE_MS} (5 phút) — vượt xa thời gian một giao
 *     dịch hợp lệ (mili-giây) nên KHÔNG bao giờ đụng đơn đang xử lý.
 *   - Chỉ xoá order KHÔNG có `order_items`. Không có gì khác trỏ tới orphan (products chưa
 *     gán order_id, transaction chưa tạo) nên DELETE an toàn, không vỡ tham chiếu.
 */

/** Tuổi tối thiểu (ms) một order phải đạt trước khi đủ điều kiện coi là orphan để xoá. */
export const ORPHAN_MIN_AGE_MS = 5 * 60 * 1000

/**
 * Xoá các orphan order: status 'completed', quá tuổi tối thiểu, và không có order_items.
 *
 * So sánh tuổi qua `strftime('%s', …)` để chuẩn hoá mọi định dạng timestamp (ISO `…T…Z`
 * lẫn `datetime('now')` có dấu cách) về epoch giây UTC — cùng quy ước với deposit-expiry.
 *
 * @param db - D1Database instance.
 * @returns Số orphan order đã xoá.
 */
export async function sweepOrphanOrders(db: D1Database): Promise<number> {
  const minAgeSec = ORPHAN_MIN_AGE_MS / 1000

  const result = await db
    .prepare(
      `DELETE FROM orders
       WHERE status = 'completed'
         AND strftime('%s','now') - strftime('%s', created_at) >= ?
         AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = orders.id)`
    )
    .bind(minAgeSec)
    .run()

  return result.meta.changes
}
