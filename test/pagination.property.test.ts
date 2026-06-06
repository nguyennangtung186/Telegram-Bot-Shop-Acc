import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { buildPaginationButtons, paginateItems, BOT_PAGE_SIZE } from '../src/bot/utils/pagination'

/**
 * Property-based tests cho pagination.
 * **Validates: Requirements 7.7**
 */

describe('Property 16: Pagination hiển thị đúng nút điều hướng', () => {
  /**
   * **Validates: Requirements 7.7**
   * First page (currentPage=0): result never contains "⬅️ Trước" button
   */
  it('first page never contains "⬅️ Trước" button', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 100 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (totalPages, prefix) => {
          const buttons = buildPaginationButtons(0, totalPages, prefix)

          const hasBackButton = buttons.some((b) => b.text.includes('Trước'))
          expect(hasBackButton).toBe(false)
        }
      ),
      { numRuns: 200 }
    )
  })

  /**
   * **Validates: Requirements 7.7**
   * Last page (currentPage=totalPages-1): result never contains "➡️ Sau" button
   */
  it('last page never contains "➡️ Sau" button', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 100 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (totalPages, prefix) => {
          const lastPage = totalPages - 1
          const buttons = buildPaginationButtons(lastPage, totalPages, prefix)

          const hasNextButton = buttons.some((b) => b.text.includes('Sau'))
          expect(hasNextButton).toBe(false)
        }
      ),
      { numRuns: 200 }
    )
  })

  /**
   * **Validates: Requirements 7.7**
   * Middle pages (0 < currentPage < totalPages-1): result contains both buttons
   */
  it('middle pages contain both "⬅️ Trước" and "➡️ Sau" buttons', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 100 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (totalPages, prefix) => {
          // Pick a middle page: between 1 and totalPages-2 inclusive
          const middlePage = 1 + Math.floor(Math.random() * (totalPages - 2))
          const buttons = buildPaginationButtons(middlePage, totalPages, prefix)

          const hasBackButton = buttons.some((b) => b.text.includes('Trước'))
          const hasNextButton = buttons.some((b) => b.text.includes('Sau'))

          expect(hasBackButton).toBe(true)
          expect(hasNextButton).toBe(true)
        }
      ),
      { numRuns: 200 }
    )
  })

  /**
   * **Validates: Requirements 7.7**
   * Single page (totalPages=1): result is empty array
   */
  it('single page returns empty array', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (currentPage, prefix) => {
          const buttons = buildPaginationButtons(currentPage, 1, prefix)
          expect(buttons).toEqual([])
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * **Validates: Requirements 7.7**
   * paginateItems: always returns at most pageSize items
   */
  it('paginateItems returns at most pageSize items', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { minLength: 1, maxLength: 200 }),
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 1, max: 20 }),
        (items, page, pageSize) => {
          const result = paginateItems(items, page, pageSize)
          expect(result.pageItems.length).toBeLessThanOrEqual(pageSize)
          expect(result.pageItems.length).toBeGreaterThanOrEqual(0)
        }
      ),
      { numRuns: 200 }
    )
  })

  /**
   * **Validates: Requirements 7.7**
   * paginateItems: totalPages = ceil(items.length / pageSize)
   */
  it('paginateItems totalPages equals ceil(items.length / pageSize)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { minLength: 1, maxLength: 200 }),
        fc.integer({ min: 1, max: 20 }),
        (items, pageSize) => {
          const result = paginateItems(items, 0, pageSize)
          const expectedTotalPages = Math.ceil(items.length / pageSize)
          expect(result.totalPages).toBe(expectedTotalPages)
        }
      ),
      { numRuns: 200 }
    )
  })

  /**
   * **Validates: Requirements 7.7**
   * paginateItems: currentPage is always within valid range [0, totalPages-1]
   */
  it('paginateItems currentPage is always clamped to [0, totalPages-1]', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { minLength: 1, maxLength: 200 }),
        fc.integer({ min: -100, max: 500 }),
        fc.integer({ min: 1, max: 20 }),
        (items, page, pageSize) => {
          const result = paginateItems(items, page, pageSize)

          expect(result.currentPage).toBeGreaterThanOrEqual(0)
          expect(result.currentPage).toBeLessThanOrEqual(result.totalPages - 1)
        }
      ),
      { numRuns: 200 }
    )
  })
})
