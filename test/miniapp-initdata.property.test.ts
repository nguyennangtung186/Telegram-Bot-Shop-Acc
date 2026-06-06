import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { verifyInitData } from '../src/utils/telegram-initdata'

// Feature: telegram-mini-app, Property 1
/**
 * Property-based test cho `verifyInitData` (round-trip).
 *
 * **Property 1: Xác thực initData round-trip**
 * **Validates: Requirements 1.2, 1.4**
 *
 * - Ký initData hợp lệ theo đúng thuật toán Telegram WebApp → `verifyInitData`
 *   trả kết quả non-null với `telegramId`/`authDate` khớp dữ liệu gốc (Req 1.2).
 * - Đột biến `hash` (lật 1 ký tự hex) → `verifyInitData` trả `null` (Req 1.4).
 * - Đột biến bất kỳ cặp `key=value` nào (giữ nguyên `hash` cũ) → trả `null` (Req 1.4).
 *
 * Chạy dưới @cloudflare/vitest-pool-workers nên Web Crypto (`crypto.subtle`)
 * có sẵn trong môi trường worker — helper ký lại dùng đúng API đó.
 */

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
 * Ký một tập field initData (đã giải mã) và trả về chuỗi initData thô
 * (URLSearchParams string) kèm trường `hash` hợp lệ.
 *
 * data_check_string = các cặp "key=value" (trừ `hash`), sort tăng dần, nối bằng "\n".
 * secret_key       = HMAC_SHA256("WebAppData", botToken)
 * hash             = hex(HMAC_SHA256(secret_key, data_check_string))
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

// Bộ ký tự an toàn cho round-trip qua URLSearchParams (gồm ký tự đặc biệt HTML
// và dấu '=' để kiểm tính bền vững khi mã hoá/giải mã), tránh surrogate/null.
const SAFE_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-.&<>"\'=@'.split('')

const arbText = fc
  .array(fc.constantFrom(...SAFE_CHARS), { maxLength: 24 })
  .map((a) => a.join(''))

const TOKEN_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:_-'.split('')

const arbToken = fc
  .array(fc.constantFrom(...TOKEN_CHARS), { minLength: 8, maxLength: 50 })
  .map((a) => a.join(''))

interface ValidInput {
  id: number
  username: string | undefined
  firstName: string | undefined
  authDate: number
  queryId: string | undefined
}

const arbValid: fc.Arbitrary<ValidInput> = fc.record({
  id: fc.integer({ min: 1, max: 9_999_999_999 }),
  username: fc.option(arbText, { nil: undefined }),
  firstName: fc.option(arbText, { nil: undefined }),
  authDate: fc.integer({ min: 1, max: 4_102_444_800 }),
  queryId: fc.option(
    arbText.filter((s) => s.length > 0),
    { nil: undefined }
  ),
})

/** Dựng tập field initData (chưa ký) từ input hợp lệ. */
function buildFields(v: ValidInput): Record<string, string> {
  const user: { id: number; username?: string; first_name?: string } = { id: v.id }
  if (v.username !== undefined) user.username = v.username
  if (v.firstName !== undefined) user.first_name = v.firstName

  const fields: Record<string, string> = {
    user: JSON.stringify(user),
    auth_date: String(v.authDate),
  }
  if (v.queryId !== undefined) fields.query_id = v.queryId
  return fields
}

// --- Property 1 ---

describe('Property 1: Xác thực initData round-trip', () => {
  /**
   * **Validates: Requirements 1.2**
   * initData được ký đúng → verify trả non-null, telegramId/authDate khớp.
   */
  it('signed initData verifies and telegramId/authDate match', async () => {
    await fc.assert(
      fc.asyncProperty(arbValid, arbToken, async (v, token) => {
        const raw = await signInitData(buildFields(v), token)
        const result = await verifyInitData(raw, token)

        expect(result).not.toBeNull()
        expect(result!.telegramId).toBe(v.id)
        expect(result!.authDate).toBe(v.authDate)
      }),
      { numRuns: 100 }
    )
  })

  /**
   * **Validates: Requirements 1.4**
   * Lật 1 ký tự hex trong `hash` → hash không khớp → verify trả null.
   */
  it('flipping one hex char in hash makes verify return null', async () => {
    const HEX = '0123456789abcdef'
    await fc.assert(
      fc.asyncProperty(arbValid, arbToken, fc.nat(), async (v, token, pick) => {
        const raw = await signInitData(buildFields(v), token)
        const params = new URLSearchParams(raw)
        const hash = params.get('hash')!

        const idx = pick % hash.length
        const orig = hash[idx]
        // Thay bằng ký tự hex khác (luôn khác orig nhờ +1 mod 16)
        const replacement = HEX[(HEX.indexOf(orig) + 1) % 16]
        const mutated = hash.slice(0, idx) + replacement + hash.slice(idx + 1)
        params.set('hash', mutated)

        const result = await verifyInitData(params.toString(), token)
        expect(result).toBeNull()
      }),
      { numRuns: 100 }
    )
  })

  /**
   * **Validates: Requirements 1.4**
   * Đột biến bất kỳ cặp `key=value` (giữ nguyên hash cũ) → verify trả null.
   */
  it('mutating any key=value pair makes verify return null', async () => {
    await fc.assert(
      fc.asyncProperty(arbValid, arbToken, fc.nat(), async (v, token, pick) => {
        const raw = await signInitData(buildFields(v), token)
        const params = new URLSearchParams(raw)

        const keys = [...params.keys()].filter((k) => k !== 'hash')
        const key = keys[pick % keys.length]
        const original = params.get(key)!
        // Đổi giá trị (khác bản gốc vì dài hơn) → data_check_string đổi → hash cũ không khớp
        params.set(key, original + 'X')

        const result = await verifyInitData(params.toString(), token)
        expect(result).toBeNull()
      }),
      { numRuns: 100 }
    )
  })
})
