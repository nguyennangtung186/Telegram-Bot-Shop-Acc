import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { Hono } from 'hono'
import { telegramAuth } from '../src/middleware/telegram-auth'
import type { AppEnv } from '../src/types'

const SECRET = 'test-secret-token-123'

// Bảng system_config cần tồn tại vì telegramAuth resolve secret token DB-first.
// Để rỗng (không seed) → middleware fallback về env.TELEGRAM_SECRET_TOKEN.
const SYSTEM_CONFIG_TABLE = `CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER
)`

function createApp() {
  const app = new Hono<AppEnv>()
  app.use('/webhook/telegram', telegramAuth)
  app.post('/webhook/telegram', (c) => c.json({ ok: true }))
  return app
}

function bindings() {
  return { DB: env.DB, TELEGRAM_SECRET_TOKEN: SECRET } as any
}

describe('telegramAuth middleware', () => {
  const app = createApp()

  beforeEach(async () => {
    await env.DB.prepare(SYSTEM_CONFIG_TABLE).run()
    await env.DB.prepare('DELETE FROM system_config').run()
  })

  it('returns 401 when header is missing', async () => {
    const res = await app.request('/webhook/telegram', {
      method: 'POST',
      body: JSON.stringify({}),
    }, bindings())

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('returns 401 when header value is incorrect', async () => {
    const res = await app.request('/webhook/telegram', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong-token' },
      body: JSON.stringify({}),
    }, bindings())

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('passes through when header matches secret', async () => {
    const res = await app.request('/webhook/telegram', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET },
      body: JSON.stringify({}),
    }, bindings())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  })

  it('returns 401 when header is empty string', async () => {
    const res = await app.request('/webhook/telegram', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': '' },
      body: JSON.stringify({}),
    }, bindings())

    expect(res.status).toBe(401)
  })

  it('uses system_config.telegram_secret_token when set (DB-first over env)', async () => {
    const dbSecret = 'db-secret-xyz'
    await env.DB
      .prepare("INSERT INTO system_config (key, value) VALUES ('telegram_secret_token', ?)")
      .bind(dbSecret)
      .run()

    // Key cũ trong env phải bị từ chối vì DB đã cấu hình.
    const resEnvKey = await app.request('/webhook/telegram', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET },
      body: JSON.stringify({}),
    }, bindings())
    expect(resEnvKey.status).toBe(401)

    // Key trong DB được chấp nhận.
    const resDbKey = await app.request('/webhook/telegram', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': dbSecret },
      body: JSON.stringify({}),
    }, bindings())
    expect(resDbKey.status).toBe(200)
  })
})
