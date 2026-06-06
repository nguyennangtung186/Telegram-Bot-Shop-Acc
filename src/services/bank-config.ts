/**
 * Bank Config — nguồn thông tin ngân hàng nhận thanh toán (dùng cho VietQR + caption CK).
 *
 * Dùng CHUNG cho bot (`handleDepositAmount`) lẫn Mini App API (`POST /deposits`) để
 * hai kênh luôn hiển thị cùng một tài khoản nhận tiền.
 *
 * Thứ tự ưu tiên: **DB trước, env sau**.
 *  1. `system_config` (key `bank_name`/`bank_account`/`bank_owner`) — admin chỉnh qua CMS,
 *     đổi runtime không cần redeploy.
 *  2. Fallback secret/var Worker (`BANK_NAME`/`BANK_ACCOUNT`/`BANK_OWNER`) khi DB chưa có
 *     hoặc bỏ trống — giữ hệ thống chạy được trên cấu hình cũ (chưa set trong CMS).
 *
 * Giá trị DB chỉ được ưu tiên khi non-empty sau `trim()`; chuỗi rỗng coi như chưa cấu
 * hình để không vô tình sinh VietQR thiếu thông tin.
 */

import type { Bindings } from '../types/bindings'

/** Thông tin ngân hàng nhận thanh toán đã resolve (DB-first). */
export interface BankConfig {
  bankName: string
  bankAccount: string
  bankOwner: string
}

/** Các key `system_config` lưu thông tin ngân hàng (do CMS ghi). */
const BANK_CONFIG_KEYS = ['bank_name', 'bank_account', 'bank_owner'] as const

/** Chọn giá trị DB nếu non-empty sau trim, ngược lại fallback env. */
function preferDbValue(dbValue: string | undefined, envValue: string): string {
  const trimmed = dbValue?.trim()
  return trimmed ? trimmed : envValue
}

/**
 * Resolve thông tin ngân hàng nhận tiền: đọc `system_config` rồi fallback env Worker.
 *
 * Một query duy nhất lấy cả ba key; thiếu key/giá trị rỗng → dùng `env.BANK_*` tương ứng.
 */
export async function resolveBankConfig(db: D1Database, env: Bindings): Promise<BankConfig> {
  const { results } = await db
    .prepare("SELECT key, value FROM system_config WHERE key IN ('bank_name', 'bank_account', 'bank_owner')")
    .all<{ key: string; value: string }>()

  const byKey = new Map(results.map((r) => [r.key, r.value]))

  return {
    bankName: preferDbValue(byKey.get('bank_name'), env.BANK_NAME),
    bankAccount: preferDbValue(byKey.get('bank_account'), env.BANK_ACCOUNT),
    bankOwner: preferDbValue(byKey.get('bank_owner'), env.BANK_OWNER),
  }
}

export { BANK_CONFIG_KEYS }
