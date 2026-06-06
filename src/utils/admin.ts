/**
 * Admin utility — kiểm tra quyền admin theo telegram_id.
 * Requirement: 8.6
 */

/**
 * Kiểm tra telegram_id có nằm trong danh sách ADMIN_IDS hay không.
 * @param telegramId - Telegram ID của user cần kiểm tra
 * @param adminIds - Chuỗi ADMIN_IDS phân tách bởi dấu phẩy (vd: "123456,789012")
 * @returns true nếu telegramId nằm trong adminIds
 */
export function isAdmin(telegramId: number, adminIds: string): boolean {
  if (!adminIds || !adminIds.trim()) {
    return false
  }

  const ids = adminIds.split(',').map((id) => id.trim()).filter(Boolean)
  return ids.includes(String(telegramId))
}
