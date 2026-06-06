import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import fc from 'fast-check'

/**
 * Property-based tests cho purchase validation.
 * **Validates: Requirements 3.1, 3.5, 3.6**
 */

// --- Schema ---

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
    is_active INTEGER DEFAULT 1,
    last_interaction_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS product_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price INTEGER NOT NULL CHECK(price > 0),
    emoji TEXT DEFAULT '📦',
    sort_order INTEGER DEFAULT 0,
    is_visible INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_id INTEGER NOT NULL REFERENCES product_types(id),
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','sold','reserved')),
    buyer_id INTEGER REFERENCES users(id),
    order_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sold_at TEXT
  )`,
]

async function applySchema(db: D1Database) {
  for (const stmt of SCHEMA_STATEMENTS) {
    await db.prepare(stmt).run()
  }
}

async function cleanTables(db: D1Database) {
  await db.prepare('DELETE FROM products').run()
  await db.prepare('DELETE FROM product_types').run()
  await db.prepare('DELETE FROM users').run()
}

// --- Helpers ---

interface CategorySetup {
  name: string
  price: number
  isVisible: boolean
  stockCount: number // number of available products to seed
}

async function seedCategory(
  db: D1Database,
  setup: CategorySetup
): Promise<number> {
  await db
    .prepare(
      "INSERT INTO product_types (name, price, is_visible, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))"
    )
    .bind(setup.name, setup.price, setup.isVisible ? 1 : 0)
    .run()
  const cat = await db.prepare('SELECT MAX(id) as id FROM product_types').first<{ id: number }>()
  const categoryId = cat!.id

  // Seed available products
  for (let i = 0; i < setup.stockCount; i++) {
    const content = `product_${categoryId}_${i}_${Math.random().toString(36).slice(2)}`
    await db
      .prepare(
        "INSERT INTO products (type_id, content, status, created_at) VALUES (?, ?, 'available', datetime('now'))"
      )
      .bind(categoryId, content)
      .run()
  }

  return categoryId
}

// The same SQL query used in handleCategoryList (src/bot/callbacks/purchase.ts)
const CATEGORY_LIST_QUERY = `
  SELECT pt.id, pt.name, pt.price, pt.emoji,
         COUNT(p.id) as stock
  FROM product_types pt
  INNER JOIN products p ON p.type_id = pt.id AND p.status = 'available'
  WHERE pt.is_visible = 1
  GROUP BY pt.id
  HAVING stock > 0
  ORDER BY pt.sort_order ASC, pt.name ASC
`

// --- Arbitraries ---

const arbCategorySetup: fc.Arbitrary<CategorySetup> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }).map((s) => s.replace(/\0/g, 'x')),
  price: fc.integer({ min: 1000, max: 999_999_999 }),
  isVisible: fc.boolean(),
  stockCount: fc.integer({ min: 0, max: 10 }),
})

// --- Property 7 ---

describe('Property 7: Category chỉ hiển thị khi có stock', () => {
  /**
   * **Validates: Requirements 3.1**
   * categories list chỉ gồm category có product available.
   */
  beforeEach(async () => {
    await applySchema(env.DB)
    await cleanTables(env.DB)
  })

  it('only categories with available stock > 0 and is_visible = 1 appear in results', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbCategorySetup, { minLength: 1, maxLength: 8 }),
        async (categories) => {
          await cleanTables(env.DB)

          // Seed all categories
          const seededIds: number[] = []
          for (const cat of categories) {
            const id = await seedCategory(env.DB, cat)
            seededIds.push(id)
          }

          // Query using the same SQL as handleCategoryList
          const result = await env.DB.prepare(CATEGORY_LIST_QUERY).all<{
            id: number
            name: string
            price: number
            stock: number
          }>()

          const returnedIds = new Set(result.results.map((r) => r.id))

          // Verify: every returned category has stock > 0 AND is_visible = 1
          for (const row of result.results) {
            expect(row.stock).toBeGreaterThan(0)
          }

          // Verify: no category with stock > 0 AND is_visible = 1 is missing
          for (let i = 0; i < categories.length; i++) {
            const cat = categories[i]
            const id = seededIds[i]

            if (cat.isVisible && cat.stockCount > 0) {
              expect(returnedIds.has(id)).toBe(true)
            } else {
              expect(returnedIds.has(id)).toBe(false)
            }
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('categories with 0 stock are never included regardless of visibility', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 30 }).map((s) => s.replace(/\0/g, 'x')),
            price: fc.integer({ min: 1000, max: 999_999_999 }),
            isVisible: fc.constant(true),
            stockCount: fc.constant(0),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        async (emptyCategories) => {
          await cleanTables(env.DB)

          for (const cat of emptyCategories) {
            await seedCategory(env.DB, cat)
          }

          const result = await env.DB.prepare(CATEGORY_LIST_QUERY).all()
          expect(result.results.length).toBe(0)
        }
      ),
      { numRuns: 50 }
    )
  })
})

// --- Property 9 ---

describe('Property 9: Quantity validation', () => {
  /**
   * **Validates: Requirements 3.5, 3.6**
   * Reject input ≤ 0, non-integer, > 50; báo stock thực tế nếu vượt.
   */

  const MAX_QTY = 50

  /**
   * Pure validation logic extracted from purchase.ts:
   * - qty must be integer
   * - qty must be > 0
   * - qty must be <= MAX_QTY (50)
   * - qty must be <= available stock
   *
   * Returns: { valid: true } | { valid: false, reason: string, actualStock?: number }
   */
  function validateQuantity(
    qty: number,
    availableStock: number
  ): { valid: true } | { valid: false; reason: string; actualStock?: number } {
    if (!Number.isInteger(qty) || qty <= 0 || qty > MAX_QTY) {
      return { valid: false, reason: 'invalid_range' }
    }
    if (qty > availableStock) {
      return { valid: false, reason: 'exceeds_stock', actualStock: availableStock }
    }
    return { valid: true }
  }

  it('rejects qty <= 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 0 }),
        fc.integer({ min: 1, max: 100 }),
        (qty, stock) => {
          const result = validateQuantity(qty, stock)
          expect(result.valid).toBe(false)
          if (!result.valid) {
            expect(result.reason).toBe('invalid_range')
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('rejects non-integer quantities', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 50, noNaN: true }).filter((n) => !Number.isInteger(n)),
        fc.integer({ min: 1, max: 100 }),
        (qty, stock) => {
          const result = validateQuantity(qty, stock)
          expect(result.valid).toBe(false)
          if (!result.valid) {
            expect(result.reason).toBe('invalid_range')
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('rejects qty > 50 (MAX_QTY)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 51, max: 10000 }),
        fc.integer({ min: 1, max: 10000 }),
        (qty, stock) => {
          const result = validateQuantity(qty, stock)
          expect(result.valid).toBe(false)
          if (!result.valid) {
            expect(result.reason).toBe('invalid_range')
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('reports actual remaining stock when qty > available stock (within valid range)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 0, max: 49 }),
        (qty, stock) => {
          fc.pre(qty > stock) // ensure qty exceeds stock

          const result = validateQuantity(qty, stock)
          expect(result.valid).toBe(false)
          if (!result.valid) {
            expect(result.reason).toBe('exceeds_stock')
            expect(result.actualStock).toBe(stock)
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('accepts valid quantities (integer, 1 <= qty <= min(50, stock))', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 100 }),
        (qty, stock) => {
          fc.pre(qty <= stock) // must not exceed stock

          const result = validateQuantity(qty, stock)
          expect(result.valid).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('NaN and Infinity are rejected', () => {
    const invalidValues = [NaN, Infinity, -Infinity]
    for (const qty of invalidValues) {
      const result = validateQuantity(qty, 10)
      expect(result.valid).toBe(false)
    }
  })
})
