import type { InlineKeyboardButton } from '../../types/telegram'

/** Default page size for bot inline keyboards */
export const BOT_PAGE_SIZE = 5

/**
 * Build pagination navigation buttons (⬅️ Trước / ➡️ Sau).
 *
 * - Trang đầu: ẩn "⬅️ Trước"
 * - Trang cuối: ẩn "➡️ Sau"
 * - Chỉ 1 trang hoặc 0 trang: trả mảng rỗng
 *
 * @param currentPage - Zero-based page index
 * @param totalPages - Total number of pages
 * @param callbackPrefix - Prefix for callback_data (e.g. "page:cat")
 * @returns Array of InlineKeyboardButton for one row (or empty if no nav needed)
 */
export function buildPaginationButtons(
  currentPage: number,
  totalPages: number,
  callbackPrefix: string
): InlineKeyboardButton[] {
  if (totalPages <= 1) {
    return []
  }

  const buttons: InlineKeyboardButton[] = []

  if (currentPage > 0) {
    buttons.push({
      text: '⬅️ Trước',
      callback_data: `${callbackPrefix}:${currentPage - 1}`,
    })
  }

  if (currentPage < totalPages - 1) {
    buttons.push({
      text: '➡️ Sau',
      callback_data: `${callbackPrefix}:${currentPage + 1}`,
    })
  }

  return buttons
}

/**
 * Paginate an array of items.
 *
 * @param items - Full array of items
 * @param page - Requested zero-based page index (clamped to valid range)
 * @param pageSize - Number of items per page (default: BOT_PAGE_SIZE = 5)
 * @returns Object with pageItems, totalPages, and bounded currentPage
 */
export function paginateItems<T>(
  items: T[],
  page: number,
  pageSize: number = BOT_PAGE_SIZE
): { pageItems: T[]; totalPages: number; currentPage: number } {
  const effectivePageSize = Math.max(1, Math.floor(pageSize))
  const totalPages = Math.max(1, Math.ceil(items.length / effectivePageSize))
  const currentPage = Math.max(0, Math.min(Math.floor(page), totalPages - 1))
  const start = currentPage * effectivePageSize
  const pageItems = items.slice(start, start + effectivePageSize)

  return { pageItems, totalPages, currentPage }
}
