/**
 * Bank Config — nguồn thông tin ngân hàng nhận thanh toán (dùng cho VietQR + caption CK).
 *
 * Dùng CHUNG cho bot (`handleDepositAmount`) lẫn Mini App API (`POST /deposits`) để
 * hai kênh luôn hiển thị cùng một tài khoản nhận tiền.
 *
 * Thứ tự ưu tiên: **DB trước, env sau** (xem `utils/system-config.preferDbValue`).
 *  1. `system_config` (key `bank_name`/`bank_account`/`bank_owner`) — admin chỉnh qua CMS,
 *     đổi runtime không cần redeploy.
 *  2. Fallback secret/var Worker (`BANK_NAME`/`BANK_ACCOUNT`/`BANK_OWNER`) khi DB chưa có
 *     hoặc bỏ trống — giữ hệ thống chạy được trên cấu hình cũ (chưa set trong CMS).
 */

import type { Bindings } from '../types/bindings'
import { readSystemConfigMap, preferDbValue } from '../utils/system-config'

/** Thông tin ngân hàng nhận thanh toán đã resolve (DB-first). */
export interface BankConfig {
  bankName: string
  bankAccount: string
  bankOwner: string
}

/** Các key `system_config` lưu thông tin ngân hàng (do CMS ghi). */
const BANK_CONFIG_KEYS = ['bank_name', 'bank_account', 'bank_owner'] as const

/**
 * Resolve thông tin ngân hàng nhận tiền: đọc `system_config` rồi fallback env Worker.
 *
 * Một query duy nhất lấy cả ba key; thiếu key/giá trị rỗng → dùng `env.BANK_*` tương ứng.
 */
export async function resolveBankConfig(db: D1Database, env: Bindings): Promise<BankConfig> {
  const byKey = await readSystemConfigMap(db, BANK_CONFIG_KEYS)

  return {
    bankName: preferDbValue(byKey.get('bank_name'), env.BANK_NAME),
    bankAccount: preferDbValue(byKey.get('bank_account'), env.BANK_ACCOUNT),
    bankOwner: preferDbValue(byKey.get('bank_owner'), env.BANK_OWNER),
  }
}

export { BANK_CONFIG_KEYS }
