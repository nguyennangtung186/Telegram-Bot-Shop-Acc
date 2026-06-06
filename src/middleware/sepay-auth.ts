import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types'
import { resolveSepayApiKey } from '../services/sepay-config'

/**
 * Middleware xác thực webhook từ SePay.
 * Kiểm tra header Authorization có format "Apikey {key}" và key khớp API key đã cấu hình.
 *
 * Nguồn key: `system_config.sepay_api_key` (admin đặt qua CMS), fallback secret
 * `SEPAY_API_KEY` của Worker — xem `resolveSepayApiKey`.
 *
 * Trả về 401 nếu thiếu/sai format header, chưa cấu hình key, hoặc key không khớp.
 */
export const sepayAuth = createMiddleware<AppEnv>(async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader || !authHeader.startsWith('Apikey ')) {
    return c.json({ success: false }, 401)
  }

  const apiKey = authHeader.slice('Apikey '.length)
  const expectedKey = await resolveSepayApiKey(c.env.DB, c.env)

  // Chưa cấu hình key ở cả DB lẫn env → không thể xác thực, từ chối (fail-safe).
  if (!expectedKey || apiKey !== expectedKey) {
    return c.json({ success: false }, 401)
  }

  await next()
})
