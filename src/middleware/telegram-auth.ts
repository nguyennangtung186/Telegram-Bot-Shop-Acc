import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types'
import { resolveTelegramSecretToken } from '../services/telegram-config'

/**
 * Middleware xác thực webhook từ Telegram.
 * Kiểm tra header X-Telegram-Bot-Api-Secret-Token khớp secret token đã cấu hình.
 *
 * Nguồn secret: `system_config.telegram_secret_token` (admin đặt qua CMS), fallback
 * secret `TELEGRAM_SECRET_TOKEN` của Worker — xem `resolveTelegramSecretToken`.
 *
 * Trả về 401 nếu thiếu header, chưa cấu hình secret, hoặc không khớp (fail-safe).
 */
export const telegramAuth = createMiddleware<AppEnv>(async (c, next) => {
  const secretToken = c.req.header('X-Telegram-Bot-Api-Secret-Token')
  const expected = await resolveTelegramSecretToken(c.env.DB, c.env)

  if (!secretToken || !expected || secretToken !== expected) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  await next()
})
