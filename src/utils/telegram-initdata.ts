/**
 * Xác thực Telegram WebApp `initData` bằng Web Crypto (HMAC-SHA256).
 *
 * Thuật toán chuẩn Telegram WebApp (2 bước HMAC):
 *   1. secret_key   = HMAC_SHA256(key = "WebAppData", message = bot_token)
 *   2. computed_hash = HMAC_SHA256(key = secret_key, message = data_check_string)
 *   3. So sánh hằng-thời-gian computed_hash (hex) với trường `hash` tách từ initData.
 *
 * `data_check_string` = nối tất cả cặp `key=value` (trừ `hash`),
 * sắp xếp key tăng dần theo alphabet, ngăn cách bằng ký tự `\n`.
 *
 * Chạy hoàn toàn trong Cloudflare Worker, KHÔNG phụ thuộc thư viện ngoài (Req 16.1).
 * Requirements: 1.2, 1.4, 1.5, 2.1, 2.4, 16.1
 */

/** Kết quả parse + verify initData (stateless, không phát hành JWT). */
export interface InitDataParsed {
  telegramId: number
  username: string | null
  firstName: string | null
  authDate: number // epoch seconds
  raw: string
}

const encoder = new TextEncoder()

/**
 * Ký HMAC-SHA256 một message với key cho trước, trả về ArrayBuffer chữ ký.
 */
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

/**
 * Chuyển ArrayBuffer chữ ký sang chuỗi hex thường (lowercase).
 */
function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * So sánh hằng-thời-gian hai chuỗi hex để tránh timing attack.
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Xác thực initData theo chuẩn Telegram WebApp.
 *
 * @param rawInitData Chuỗi initData thô (URLSearchParams) do Telegram WebApp cung cấp.
 * @param botToken Token bot dùng làm message ở bước 1 của HMAC.
 * @returns `InitDataParsed` nếu hash hợp lệ và đủ trường; `null` nếu sai hash / thiếu trường.
 *   Việc kiểm tra TTL được tách riêng (xem `isInitDataFresh`) để trả lỗi đúng ngữ nghĩa.
 */
export async function verifyInitData(
  rawInitData: string,
  botToken: string
): Promise<InitDataParsed | null> {
  const params = new URLSearchParams(rawInitData)
  const hash = params.get('hash')
  if (!hash) return null

  // data_check_string: bỏ hash, sort key tăng dần, nối "key=value" bằng \n
  const pairs: string[] = []
  for (const [k, v] of params.entries()) {
    if (k === 'hash') continue
    pairs.push(`${k}=${v}`)
  }
  pairs.sort()
  const dataCheckString = pairs.join('\n')

  // Bước 1: secret_key = HMAC_SHA256("WebAppData", bot_token)
  const secretKey = await hmacSha256(encoder.encode('WebAppData'), botToken)
  // Bước 2: computed = HMAC_SHA256(secret_key, data_check_string)
  const computed = toHex(await hmacSha256(secretKey, dataCheckString))

  if (!timingSafeEqualHex(computed, hash)) return null

  // auth_date bắt buộc và phải là số hợp lệ (Req 2.1, 2.3)
  const authDate = Number(params.get('auth_date'))
  if (!authDate || Number.isNaN(authDate)) return null

  // Trích thông tin người dùng từ trường `user` (JSON encode) — Req 1.5
  const userJson = params.get('user')
  if (!userJson) return null
  let user: { id?: number; username?: string; first_name?: string }
  try {
    user = JSON.parse(userJson)
  } catch {
    return null
  }
  if (!user?.id) return null

  return {
    telegramId: user.id,
    username: user.username ?? null,
    firstName: user.first_name ?? null,
    authDate,
    raw: rawInitData,
  }
}

/**
 * Kiểm tra initData còn "tươi" theo TTL để chống replay (Req 2.2, 2.4).
 * Chỉ gọi SAU khi `verifyInitData` đã xác thực hash thành công.
 *
 * @returns `true` khi và chỉ khi `0 <= nowSeconds - authDate <= ttlSeconds`.
 */
export function isInitDataFresh(
  authDate: number,
  ttlSeconds: number,
  nowSeconds: number
): boolean {
  return nowSeconds >= authDate && nowSeconds - authDate <= ttlSeconds
}
