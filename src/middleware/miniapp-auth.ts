/**
 * Middleware xác thực Telegram Mini App bằng `initData` (stateless).
 *
 * Trên MỖI request tới `/api/app/*`:
 *   1. Đọc header `X-Telegram-Init-Data` (initData thô) — thiếu → 401 (Req 1.3).
 *   2. `verifyInitData` (HMAC-SHA256 bằng Web Crypto) — sai hash/thiếu trường → 401 (Req 1.4, 2.3, 15.2).
 *   3. `isInitDataFresh` theo TTL chống replay — hết hạn → 401 (Req 2.2, 2.4).
 *   4. `getOrCreateUser` theo `telegram_id` (JOIN/lọc qua cột này, KHÔNG dùng làm `users.id`),
 *      gắn `telegramId` + bản ghi `users` vào context (Req 1.6, 3).
 *
 * KHÔNG phát hành JWT/phiên đăng nhập riêng cho Mini App (Req 1.7).
 *
 * Requirements: 1.3, 1.4, 1.6, 1.7, 2.2, 3.1, 3.2, 3.3, 15.2
 */

import { createMiddleware } from 'hono/factory'
import type { Bindings } from '../types'
import type { DbUser } from '../types/db'
import {
  verifyInitData,
  isInitDataFresh,
  type InitDataParsed,
} from '../utils/telegram-initdata'

/** TTL cho initData: 1 giờ (Req 2.2). */
const INIT_DATA_TTL_SECONDS = 3600

/** Context variables được set bởi `miniAppAuth` cho các handler `/api/app/*`. */
export type MiniAppVariables = {
  /** telegram_id trích từ initData đã xác thực (định danh người mua). */
  telegramId: number
  /** Bản ghi `users` tương ứng (đã upsert theo telegram_id). */
  user: DbUser
}

type MiniAppEnv = {
  Bindings: Bindings
  Variables: MiniAppVariables
}

/**
 * Middleware xác thực initData cho toàn bộ prefix `/api/app/*`.
 * Mọi nhánh từ chối trả về HTTP 401 với shape `ApiResponse` (`{ success, data, error }`),
 * và KHÔNG chạm tới logic nghiệp vụ (return sớm trước `next()`).
 */
export const miniAppAuth = createMiddleware<MiniAppEnv>(async (c, next) => {
  // 1. Bắt buộc có header initData thô (Req 1.1, 1.3)
  const raw = c.req.header('X-Telegram-Init-Data')
  if (!raw) {
    return c.json({ success: false, data: null, error: 'Missing initData' }, 401)
  }

  // 2. Xác thực HMAC-SHA256 + đủ trường (Req 1.4, 2.3, 15.2)
  const parsed = await verifyInitData(raw, c.env.BOT_TOKEN)
  if (!parsed) {
    return c.json({ success: false, data: null, error: 'Invalid initData' }, 401)
  }

  // 3. Chống replay theo TTL — chỉ kiểm sau khi hash hợp lệ (Req 2.2, 2.4)
  const now = Math.floor(Date.now() / 1000)
  if (!isInitDataFresh(parsed.authDate, INIT_DATA_TTL_SECONDS, now)) {
    return c.json({ success: false, data: null, error: 'initData expired' }, 401)
  }

  // 4. Định danh người mua qua telegram_id + tự tạo user nếu chưa có (Req 1.6, 3)
  const user = await getOrCreateUser(c.env.DB, parsed)

  // 5. Chặn user bị ban (is_active = 0) — không cho thao tác bất kỳ API nghiệp vụ nào.
  if (user.is_active === 0) {
    return c.json({ success: false, data: null, error: 'Tài khoản đã bị khoá' }, 403)
  }

  c.set('telegramId', parsed.telegramId)
  c.set('user', user)

  await next()
})

/**
 * Lấy `users` theo `telegram_id`; nếu chưa tồn tại → tạo mới với `balance = 0`
 * theo cùng quy tắc khởi tạo của flow `/start` (`src/bot/commands/start.ts`).
 *
 * Dùng `INSERT ... ON CONFLICT(telegram_id) DO UPDATE` để idempotent dưới đồng thời:
 * nhiều request cùng `telegram_id` chỉ tạo đúng một bản ghi (Req 3.3). `telegram_id`
 * có ràng buộc `UNIQUE` (migration 0001) nên `ON CONFLICT(telegram_id)` an toàn.
 *
 * `telegram_id` chỉ dùng để định danh/lọc, KHÔNG dùng trực tiếp làm `users.id` (Req 1.6).
 *
 * @returns Bản ghi `DbUser` hiện hành (vừa tạo hoặc đã có).
 */
export async function getOrCreateUser(
  db: D1Database,
  p: InitDataParsed
): Promise<DbUser> {
  const now = new Date().toISOString()

  await db
    .prepare(
      `INSERT INTO users (telegram_id, username, first_name, balance, is_active, last_interaction_at, created_at, updated_at)
       VALUES (?, ?, ?, 0, 1, ?, ?, ?)
       ON CONFLICT(telegram_id) DO UPDATE SET
         username = excluded.username,
         first_name = excluded.first_name,
         last_interaction_at = excluded.last_interaction_at,
         updated_at = excluded.updated_at`
    )
    .bind(p.telegramId, p.username, p.firstName, now, now, now)
    .run()

  return db
    .prepare('SELECT * FROM users WHERE telegram_id = ?')
    .bind(p.telegramId)
    .first<DbUser>() as Promise<DbUser>
}
