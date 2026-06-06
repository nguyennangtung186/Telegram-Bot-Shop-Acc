/**
 * Telegram Config — nguồn `bot_token`, `telegram_secret_token`, `admin_ids` cho runtime.
 *
 * Cùng triết lý với `bank-config`/`sepay-config`: **DB trước, env sau**.
 *  1. `system_config` (key `bot_token`/`telegram_secret_token`/`admin_ids`) — admin chỉnh
 *     qua CMS, đổi runtime không cần redeploy hay đặt lại secret Worker.
 *  2. Fallback secret/var Worker (`BOT_TOKEN`/`TELEGRAM_SECRET_TOKEN`/`ADMIN_IDS`) khi DB
 *     chưa có hoặc bỏ trống — giữ tương thích cấu hình cũ.
 *
 * Giá trị DB chỉ được ưu tiên khi non-empty sau `trim()`; rỗng coi như "chưa cấu hình"
 * để admin có thể xoá giá trị trong CMS mà hệ thống tự quay về secret env.
 *
 * Lưu ý: các consumer (middleware xác thực, gửi tin nhắn) phải coi chuỗi rỗng trả về là
 * "chưa cấu hình" và xử lý fail-safe (vd: middleware từ chối 401).
 */

import type { Bindings } from '../types/bindings'

/** Các key `system_config` lưu cấu hình Telegram (do CMS ghi). */
export const BOT_TOKEN_CONFIG = 'bot_token'
export const TELEGRAM_SECRET_TOKEN_CONFIG = 'telegram_secret_token'
export const ADMIN_IDS_CONFIG = 'admin_ids'

/** Cấu hình Telegram đã resolve cho luồng webhook bot (token + danh sách admin). */
export interface TelegramRuntimeConfig {
  botToken: string
  adminIds: string
}

/** Chọn giá trị DB nếu non-empty sau trim, ngược lại fallback env. */
function preferDbValue(dbValue: string | undefined, envValue: string | undefined): string {
  const trimmed = dbValue?.trim()
  return trimmed ? trimmed : (envValue ?? '')
}

/** Đọc một giá trị config đơn lẻ từ `system_config`. */
async function readConfigValue(db: D1Database, key: string): Promise<string | undefined> {
  const row = await db
    .prepare('SELECT value FROM system_config WHERE key = ?')
    .bind(key)
    .first<{ value: string }>()
  return row?.value
}

/** Resolve `bot_token` (DB-first, fallback `env.BOT_TOKEN`). */
export async function resolveBotToken(db: D1Database, env: Bindings): Promise<string> {
  return preferDbValue(await readConfigValue(db, BOT_TOKEN_CONFIG), env.BOT_TOKEN)
}

/** Resolve `telegram_secret_token` (DB-first, fallback `env.TELEGRAM_SECRET_TOKEN`). */
export async function resolveTelegramSecretToken(db: D1Database, env: Bindings): Promise<string> {
  return preferDbValue(await readConfigValue(db, TELEGRAM_SECRET_TOKEN_CONFIG), env.TELEGRAM_SECRET_TOKEN)
}

/**
 * Resolve cấu hình cho luồng webhook bot: lấy `bot_token` + `admin_ids` trong MỘT query
 * (hot path — mỗi update gọi một lần).
 */
export async function resolveTelegramRuntimeConfig(
  db: D1Database,
  env: Bindings
): Promise<TelegramRuntimeConfig> {
  const { results } = await db
    .prepare("SELECT key, value FROM system_config WHERE key IN ('bot_token', 'admin_ids')")
    .all<{ key: string; value: string }>()

  const byKey = new Map(results.map((r) => [r.key, r.value]))

  return {
    botToken: preferDbValue(byKey.get(BOT_TOKEN_CONFIG), env.BOT_TOKEN),
    adminIds: preferDbValue(byKey.get(ADMIN_IDS_CONFIG), env.ADMIN_IDS),
  }
}
