import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types'

/**
 * Middleware xác thực webhook từ SePay.
 * Kiểm tra header Authorization có format "Apikey {key}" và key khớp SEPAY_API_KEY.
 * Trả về 401 nếu thiếu, sai format, hoặc không khớp.
 */
export const sepayAuth = createMiddleware<AppEnv>(async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader || !authHeader.startsWith('Apikey ')) {
    return c.json({ success: false }, 401)
  }

  const apiKey = authHeader.slice('Apikey '.length)

  if (apiKey !== c.env.SEPAY_API_KEY) {
    return c.json({ success: false }, 401)
  }

  await next()
})
