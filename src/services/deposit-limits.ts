/**
 * Deposit Limits — giới hạn số tiền nạp (`min_deposit`/`max_deposit`) lấy từ `system_config`.
 *
 * Dùng CHUNG cho mọi nơi cần kiểm tra hạn mức nạp để hành vi nhất quán:
 *  - Mini App API (`POST /api/app/deposits`) khi tạo yêu cầu nạp.
 *  - Webhook SePay (`/webhook/sepay`) khi quyết định có cộng tiền cho giao dịch tới hay không.
 *
 * Nguồn sự thật là `system_config` (admin chỉnh qua CMS). Giá trị thiếu/không hợp lệ
 * (rỗng, không phải số nguyên dương) → dùng fallback bằng giá trị seed của migration
 * `0001_initial_schema.sql` để không chặn nhầm nạp hợp lệ khi config bị xoá/migrate lỗi
 * (fail-safe). Nếu `min > max` (config mâu thuẫn) → hoán đổi để khoảng luôn hợp lệ.
 */

import { readSystemConfigMap } from '../utils/system-config'

/** Fallback khi `system_config` thiếu key — khớp giá trị seed migration `0001`. */
export const DEFAULT_MIN_DEPOSIT = 20_000
export const DEFAULT_MAX_DEPOSIT = 100_000_000

/** Khoảng hạn mức nạp đã resolve (VNĐ, số nguyên dương, đảm bảo `min <= max`). */
export interface DepositLimits {
  min: number
  max: number
}

/**
 * Đọc giới hạn số tiền nạp từ `system_config`.
 *
 * SELECT cả hai key `min_deposit`/`max_deposit` trong một query, parse số nguyên dương.
 */
export async function readDepositLimits(db: D1Database): Promise<DepositLimits> {
  const byKey = await readSystemConfigMap(db, ['min_deposit', 'max_deposit'])

  let min = parsePositiveInt(byKey.get('min_deposit'), DEFAULT_MIN_DEPOSIT)
  let max = parsePositiveInt(byKey.get('max_deposit'), DEFAULT_MAX_DEPOSIT)
  if (min > max) [min, max] = [max, min]
  return { min, max }
}

/** Parse chuỗi config sang số nguyên dương; không hợp lệ → fallback. */
function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}
