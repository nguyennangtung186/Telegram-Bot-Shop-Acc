/**
 * Format utilities — currency, date.
 * Requirements: 2.4
 */

/**
 * Format số tiền VNĐ với thousand separators.
 * Ví dụ: 150000 → "150,000đ"
 */
export function formatCurrency(amount: number): string {
  return amount.toLocaleString('en-US') + 'đ'
}

/**
 * Convert ISO 8601 UTC string sang "DD/MM/YYYY HH:mm".
 * Ví dụ: "2024-07-02T11:08:33.000Z" → "02/07/2024 11:08"
 */
export function formatDate(isoString: string): string {
  const date = new Date(isoString)

  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const year = date.getUTCFullYear()
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')

  return `${day}/${month}/${year} ${hours}:${minutes}`
}
