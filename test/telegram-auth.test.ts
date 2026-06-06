import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { telegramAuth } from '../src/middleware/telegram-auth'
import type { AppEnv } from '../src/types'

const SECRET = 'test-secret-token-123'

function createApp() {
  const app = new Hono<AppEnv>()
  app.use('/webhook/telegram', telegramAuth)
  app.post('/webhook/telegram', (c) => c.json({ ok: true }))
  return app
}

describe('telegramAuth middleware', () => {
  const app = createApp()

  it('returns 401 when header is missing', async () => {
    const res = await app.request('/webhook/telegram', {
      method: 'POST',
      body: JSON.stringify({}),
    }, { TELEGRAM_SECRET_TOKEN: SECRET } as any)

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('returns 401 when header value is incorrect', async () => {
    const res = await app.request('/webhook/telegram', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong-token' },
      body: JSON.stringify({}),
    }, { TELEGRAM_SECRET_TOKEN: SECRET } as any)

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('passes through when header matches secret', async () => {
    const res = await app.request('/webhook/telegram', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET },
      body: JSON.stringify({}),
    }, { TELEGRAM_SECRET_TOKEN: SECRET } as any)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  })

  it('returns 401 when header is empty string', async () => {
    const res = await app.request('/webhook/telegram', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': '' },
      body: JSON.stringify({}),
    }, { TELEGRAM_SECRET_TOKEN: SECRET } as any)

    expect(res.status).toBe(401)
  })
})
