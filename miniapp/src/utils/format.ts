/**
 * format.ts — tiện ích hiển thị phía frontend.
 *
 * Mirror chính xác logic của backend `src/utils/format.ts` để Mini App hiển thị
 * tiền/thời gian thống nhất với tin nhắn bot và payload server. Dùng làm fallback
 * khi server chưa kèm chuỗi `*_display` (vd cập nhật số dư sau khi poll nạp).
 */

/**
 * Format số tiền VNĐ với dấu phân cách hàng nghìn.
 * Ví dụ: 150000 → "150,000đ". Khớp `formatCurrency` backend.
 */
export function formatCurrency(amount: number): string {
  return amount.toLocaleString('en-US') + 'đ'
}

/**
 * Convert chuỗi ISO 8601 UTC sang "DD/MM/YYYY HH:mm" theo giờ UTC.
 * Khớp `formatDate` backend để hiển thị thời gian đơn hàng nhất quán.
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
