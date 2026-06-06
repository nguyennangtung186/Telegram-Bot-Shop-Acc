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
import { readSystemConfigMap, readSystemConfigValue, preferDbValue } from '../utils/system-config'

/** Các key `system_config` lưu cấu hình Telegram (do CMS ghi). */
export const BOT_TOKEN_CONFIG = 'bot_token'
export const TELEGRAM_SECRET_TOKEN_CONFIG = 'telegram_secret_token'
export const ADMIN_IDS_CONFIG = 'admin_ids'

/** Cấu hình Telegram đã resolve cho luồng webhook bot (token + danh sách admin). */
export interface TelegramRuntimeConfig {
  botToken: string
  adminIds: string
}

/** Resolve `bot_token` (DB-first, fallback `env.BOT_TOKEN`). */
export async function resolveBotToken(db: D1Database, env: Bindings): Promise<string> {
  return preferDbValue(await readSystemConfigValue(db, BOT_TOKEN_CONFIG), env.BOT_TOKEN)
}

/** Resolve `telegram_secret_token` (DB-first, fallback `env.TELEGRAM_SECRET_TOKEN`). */
export async function resolveTelegramSecretToken(db: D1Database, env: Bindings): Promise<string> {
  return preferDbValue(await readSystemConfigValue(db, TELEGRAM_SECRET_TOKEN_CONFIG), env.TELEGRAM_SECRET_TOKEN)
}

/**
 * Resolve cấu hình cho luồng webhook bot: lấy `bot_token` + `admin_ids` trong MỘT query
 * (hot path — mỗi update gọi một lần).
 */
export async function resolveTelegramRuntimeConfig(
  db: D1Database,
  env: Bindings
): Promise<TelegramRuntimeConfig> {
  const byKey = await readSystemConfigMap(db, [BOT_TOKEN_CONFIG, ADMIN_IDS_CONFIG])

  return {
    botToken: preferDbValue(byKey.get(BOT_TOKEN_CONFIG), env.BOT_TOKEN),
    adminIds: preferDbValue(byKey.get(ADMIN_IDS_CONFIG), env.ADMIN_IDS),
  }
}
