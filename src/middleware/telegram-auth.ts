import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types'

/**
 * Middleware xác thực webhook từ Telegram.
 * Kiểm tra header X-Telegram-Bot-Api-Secret-Token khớp với TELEGRAM_SECRET_TOKEN.
 * Trả về 401 nếu thiếu hoặc không khớp.
 */
export const telegramAuth = createMiddleware<AppEnv>(async (c, next) => {
  const secretToken = c.req.header('X-Telegram-Bot-Api-Secret-Token')

  if (!secretToken || secretToken !== c.env.TELEGRAM_SECRET_TOKEN) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  await next()
})
