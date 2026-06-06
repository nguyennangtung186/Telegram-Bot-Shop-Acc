import { Hono } from 'hono'
import type { AppEnv } from './types'
import type { Bindings } from './types/bindings'
import { telegramWebhook } from './routes/telegram'
import { sepayWebhook } from './routes/sepay'
import { adminApi } from './routes/admin'
import { miniAppApi } from './routes/miniapp-api'
import { staticAssets } from './routes/static'
import { miniAppStatic } from './routes/miniapp-static'
import { expirePendingDeposits } from './services/deposit-expiry'

const app = new Hono<AppEnv>()

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }))

// Webhook routes
app.route('/webhook', telegramWebhook)
app.route('/webhook', sepayWebhook)

// CMS API (JWT protected)
app.route('/api/admin', adminApi)

// Mini App business API (verify initData per-request)
app.route('/api/app', miniAppApi)

// Static assets for Mini App SPA (history mode)
app.route('/app', miniAppStatic)

// Static assets for CMS SPA
app.route('/cms', staticAssets)

// 404 fallback
app.all('*', (c) => c.json({ error: 'Not Found' }, 404))

// Export Hono app instance for testing (app.request())
export { app }

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) => {
    ctx.waitUntil(expirePendingDeposits(env.DB))
  },
}
