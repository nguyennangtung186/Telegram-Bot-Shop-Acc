/**
 * SePay Config — nguồn API key xác thực webhook SePay.
 *
 * Thứ tự ưu tiên: **DB trước, env sau** (giống `bank-config`).
 *  1. `system_config` (key `sepay_api_key`) — admin chỉnh qua CMS, đổi runtime không cần
 *     redeploy/đặt lại secret.
 *  2. Fallback secret Worker `SEPAY_API_KEY` khi DB chưa có hoặc bỏ trống — giữ tương
 *     thích với cấu hình cũ (chưa set trong CMS).
 *
 * Giá trị DB chỉ được ưu tiên khi non-empty sau `trim()`; chuỗi rỗng coi như chưa cấu
 * hình để admin có thể "xoá" key trong CMS mà hệ thống tự quay về secret env.
 */

import type { Bindings } from '../types/bindings'

/** Key `system_config` lưu API key webhook SePay (do CMS ghi). */
export const SEPAY_API_KEY_CONFIG = 'sepay_api_key'

/**
 * Resolve API key dùng để xác thực webhook SePay: đọc `system_config` rồi fallback env.
 *
 * @returns Chuỗi key đã resolve. Có thể rỗng nếu cả DB lẫn env đều chưa cấu hình —
 *          caller (middleware) phải coi rỗng là "không thể xác thực" và từ chối request.
 */
export async function resolveSepayApiKey(db: D1Database, env: Bindings): Promise<string> {
  const row = await db
    .prepare('SELECT value FROM system_config WHERE key = ?')
    .bind(SEPAY_API_KEY_CONFIG)
    .first<{ value: string }>()

  const dbValue = row?.value?.trim()
  return dbValue ? dbValue : (env.SEPAY_API_KEY ?? '')
}
