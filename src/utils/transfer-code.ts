/**
 * Transfer code generator — tạo mã chuyển khoản duy nhất cho deposits.
 * Format: "NAP" + 4 char base từ userId + 6 random alphanumeric chars.
 * Tổng độ dài: 13 chars (NAP=3 + base=4 + random=6).
 * Regex match: NAP[A-Z0-9]{4,17}
 * Requirement: 2.4
 */

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/**
 * Tạo mã chuyển khoản duy nhất.
 * Format: "NAP" + 4-char base (từ userId) + 6 random alphanumeric uppercase.
 */
export function generateTransferCode(userId: number): string {
  const base = encodeUserId(userId)
  const random = generateRandom(6)
  return `NAP${base}${random}`
}

/**
 * Encode userId thành 4 ký tự alphanumeric uppercase.
 * Dùng base-36 encoding, padding/truncate về 4 chars.
 */
function encodeUserId(userId: number): string {
  const encoded = Math.abs(userId).toString(36).toUpperCase()
  if (encoded.length >= 4) {
    return encoded.slice(-4)
  }
  return encoded.padStart(4, '0')
}

/**
 * Generate random alphanumeric string với crypto.getRandomValues.
 */
function generateRandom(length: number): string {
  const values = new Uint8Array(length)
  crypto.getRandomValues(values)
  let result = ''
  for (let i = 0; i < length; i++) {
    result += ALPHANUMERIC[values[i] % ALPHANUMERIC.length]
  }
  return result
}
