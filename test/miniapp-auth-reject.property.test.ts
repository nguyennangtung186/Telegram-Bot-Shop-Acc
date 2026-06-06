import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { Hono } from 'hono'
import fc from 'fast-check'
import { miniAppAuth } from '../src/middleware/miniapp-auth'

// Feature: telegram-mini-app, Property 2
/**
 * Property-based test cho middleware `miniAppAuth` — initData không hợp lệ luôn bị từ chối.
 *
 * **Property 2: initData không hợp lệ luôn bị từ chối 401**
 * **Validates: Requirements 1.3, 1.4, 2.3, 15.2**
 *
 * Với mọi initData không hợp lệ ở 3 dạng:
 *   (a) THIẾU header `X-Telegram-Init-Data` hoàn toàn          → 401 (Req 1.3)
 *   (b) initData có mặt nhưng `hash` SAI (lật ký tự hex)        → 401 (Req 1.4)
 *   (c) initData ký đúng nhưng THIẾU `auth_date`               → 401 (Req 2.3)
 *
 * Trong mọi trường hợp, logic nghiệp vụ KHÔNG được chạm tới (Req 15.2): handler
 * `/probe` đứng sau middleware không được thực thi → `businessHit` không tăng.
 *
 * Dùng một Hono app standalone tối giản (CHỈ middleware + 1 route probe) để cô lập
 * middleware, không phụ thuộc `src/index.ts` hay các route `/api/app/*` (chưa đăng ký).
 * Chạy dưới @cloudflare/vitest-pool-workers nên Web Crypto + D1 thật có sẵn.
 */

const BOT_TOKEN = 'test-bot-token'

// Schema `users` tối thiểu (giống test/integration.test.ts) — middleware gọi
// getOrCreateUser upsert vào bảng này khi (và chỉ khi) initData hợp lệ.
const USERS_TABLE = `CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
  is_active INTEGER DEFAULT 1,
  last_interaction_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

// Bảng system_config cần tồn tại vì miniAppAuth resolve bot_token DB-first.
// Để rỗng → fallback về env.BOT_TOKEN (BOT_TOKEN dưới đây).
const SYSTEM_CONFIG_TABLE = `CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER
)`

// --- Hono app standalone: middleware miniAppAuth + 1 route nghiệp vụ "probe" ---

let businessHit = 0

const testApp = new Hono()
testApp.use('/*', miniAppAuth)
testApp.get('/probe', (c) => {
  businessHit++
  return c.json({ ok: true })
})

function getEnvBindings() {
  return { DB: env.DB, BOT_TOKEN }
}

// --- Helper: ký initData hợp lệ (tái hiện thuật toán Telegram WebApp) ---

const encoder = new TextEncoder()

async function hmacSha256(
  keyBytes: ArrayBuffer | Uint8Array,
  message: string
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return crypto.subtle.sign('HMAC', key, encoder.encode(message))
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Ký một tập field initData và trả chuỗi initData thô (URLSearchParams) kèm `hash` hợp lệ.
 * data_check_string = các cặp "key=value" (trừ `hash`), sort tăng dần, nối bằng "\n".
 */
async function signInitData(
  fields: Record<string, string>,
  botToken: string
): Promise<string> {
  const pairs = Object.keys(fields)
    .filter((k) => k !== 'hash')
    .map((k) => `${k}=${fields[k]}`)
  pairs.sort()
  const dataCheckString = pairs.join('\n')

  const secretKey = await hmacSha256(encoder.encode('WebAppData'), botToken)
  const hash = toHex(await hmacSha256(secretKey, dataCheckString))

  const params = new URLSearchParams()
  for (const k of Object.keys(fields)) params.append(k, fields[k])
  params.append('hash', hash)
  return params.toString()
}

// --- Arbitraries ---

const SAFE_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-.&<>"\'=@'.split('')

const arbText = fc
  .array(fc.constantFrom(...SAFE_CHARS), { maxLength: 24 })
  .map((a) => a.join(''))

interface ValidInput {
  id: number
  username: string | undefined
  firstName: string | undefined
  authDate: number
}

const arbValid: fc.Arbitrary<ValidInput> = fc.record({
  id: fc.integer({ min: 1, max: 9_999_999_999 }),
  username: fc.option(arbText, { nil: undefined }),
  firstName: fc.option(arbText, { nil: undefined }),
  authDate: fc.integer({ min: 1, max: 4_102_444_800 }),
})

/** Dựng field `user` (+ tuỳ chọn `auth_date`) từ input hợp lệ. */
function buildUserField(v: ValidInput): Record<string, string> {
  const user: { id: number; username?: string; first_name?: string } = { id: v.id }
  if (v.username !== undefined) user.username = v.username
  if (v.firstName !== undefined) user.first_name = v.firstName
  return { user: JSON.stringify(user) }
}

// --- Setup: bảng users + dọn sạch trước mỗi test ---

beforeEach(async () => {
  await env.DB.prepare(USERS_TABLE).run()
  await env.DB.prepare(SYSTEM_CONFIG_TABLE).run()
  await env.DB.prepare('DELETE FROM users').run()
  businessHit = 0
})

// --- Property 2 ---

describe('Property 2: initData không hợp lệ luôn bị từ chối 401', () => {
  /**
   * **Validates: Requirements 1.3, 15.2**
   * (a) THIẾU header initData hoàn toàn → 401, không chạm logic nghiệp vụ.
   */
  it('(a) missing X-Telegram-Init-Data header → 401 and business untouched', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        businessHit = 0
        const res = await testApp.request('/probe', {}, getEnvBindings() as any)
        expect(res.status).toBe(401)
        expect(businessHit).toBe(0)
      }),
      { numRuns: 100 }
    )
  })

  /**
   * **Validates: Requirements 1.4, 15.2**
   * (b) initData có mặt nhưng `hash` SAI (lật 1 ký tự hex) → 401, không chạm logic nghiệp vụ.
   */
  it('(b) present initData with wrong hash → 401 and business untouched', async () => {
    const HEX = '0123456789abcdef'
    await fc.assert(
      fc.asyncProperty(arbValid, fc.nat(), async (v, pick) => {
        businessHit = 0

        // Ký hợp lệ (gồm auth_date) rồi đột biến hash → hash không khớp data.
        const fields = { ...buildUserField(v), auth_date: String(v.authDate) }
        const raw = await signInitData(fields, BOT_TOKEN)
        const params = new URLSearchParams(raw)
        const hash = params.get('hash')!

        const idx = pick % hash.length
        const replacement = HEX[(HEX.indexOf(hash[idx]) + 1) % 16]
        const mutated = hash.slice(0, idx) + replacement + hash.slice(idx + 1)
        params.set('hash', mutated)

        const res = await testApp.request(
          '/probe',
          { headers: { 'X-Telegram-Init-Data': params.toString() } },
          getEnvBindings() as any
        )
        expect(res.status).toBe(401)
        expect(businessHit).toBe(0)
      }),
      { numRuns: 100 }
    )
  })

  /**
   * **Validates: Requirements 2.3, 15.2**
   * (c) initData ký đúng nhưng THIẾU `auth_date` → hash khớp data nhưng verifyInitData
   * trả null vì thiếu auth_date → 401, không chạm logic nghiệp vụ.
   */
  it('(c) initData missing auth_date → 401 and business untouched', async () => {
    await fc.assert(
      fc.asyncProperty(arbValid, async (v) => {
        businessHit = 0

        // Ký payload KHÔNG có auth_date → hash khớp data_check_string nhưng auth_date vắng mặt.
        const fields = buildUserField(v)
        const raw = await signInitData(fields, BOT_TOKEN)
        expect(new URLSearchParams(raw).has('auth_date')).toBe(false)

        const res = await testApp.request(
          '/probe',
          { headers: { 'X-Telegram-Init-Data': raw } },
          getEnvBindings() as any
        )
        expect(res.status).toBe(401)
        expect(businessHit).toBe(0)
      }),
      { numRuns: 100 }
    )
  })
})
