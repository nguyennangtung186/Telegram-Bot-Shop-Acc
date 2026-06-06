import type { DbOrder, DbProduct, DbUser } from '../types/db'

export interface PurchaseResult {
  success: boolean
  order?: DbOrder
  products?: DbProduct[]
  error?: 'insufficient_balance' | 'insufficient_stock' | 'db_error'
}

export interface DepositResult {
  success: boolean
  newBalance?: number
  error?: 'already_processed' | 'expired' | 'not_found' | 'db_error'
}

export class TransactionService {
  /**
   * Atomic purchase: check balance → deduct → mark products sold → create order + order_items + transaction.
   * Two-phase: insert order first (to get id), then batch the rest atomically.
   * Concurrency guard: balance UPDATE has WHERE balance >= totalAmount.
   */
  async executePurchase(
    db: D1Database,
    userId: number,
    categoryId: number,
    quantity: number,
    unitPrice: number
  ): Promise<PurchaseResult> {
    const totalAmount = quantity * unitPrice
    const now = new Date().toISOString()

    // 1. Query user balance and available products
    const [userResult, productsResult] = await Promise.all([
      db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<DbUser>(),
      db
        .prepare(
          "SELECT * FROM products WHERE type_id = ? AND status = 'available' ORDER BY created_at ASC LIMIT ?"
        )
        .bind(categoryId, quantity)
        .all<DbProduct>(),
    ])

    if (!userResult) {
      return { success: false, error: 'db_error' }
    }

    // 2. Pre-checks
    if (userResult.balance < totalAmount) {
      return { success: false, error: 'insufficient_balance' }
    }

    const availableProducts = productsResult.results
    if (availableProducts.length < quantity) {
      return { success: false, error: 'insufficient_stock' }
    }

    const balanceBefore = userResult.balance
    const balanceAfter = balanceBefore - totalAmount

    // 3. Phase 1: INSERT order first to get orderId
    let orderId: number
    try {
      const orderInsert = await db
        .prepare(
          'INSERT INTO orders (user_id, product_type_id, quantity, total_amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id'
        )
        .bind(userId, categoryId, quantity, totalAmount, 'completed', now)
        .first<{ id: number }>()
      if (!orderInsert) {
        return { success: false, error: 'db_error' }
      }
      orderId = orderInsert.id
    } catch {
      return { success: false, error: 'db_error' }
    }

    // 4. Phase 2: batch the rest atomically (using orderId from phase 1)
    const stmts: D1PreparedStatement[] = []

    // 4a. Deduct balance with concurrency guard
    stmts.push(
      db
        .prepare('UPDATE users SET balance = ?, updated_at = ? WHERE id = ? AND balance >= ?')
        .bind(balanceAfter, now, userId, totalAmount)
    )

    // 4b. Mark each product as sold (link to known orderId)
    for (const product of availableProducts) {
      stmts.push(
        db
          .prepare(
            "UPDATE products SET status = 'sold', buyer_id = ?, order_id = ?, sold_at = ? WHERE id = ? AND status = 'available'"
          )
          .bind(userId, orderId, now, product.id)
      )
    }

    // 4c. Insert order_items (using known orderId)
    for (const product of availableProducts) {
      stmts.push(
        db
          .prepare(
            'INSERT INTO order_items (order_id, product_id, created_at) VALUES (?, ?, ?)'
          )
          .bind(orderId, product.id, now)
      )
    }

    // 4d. Create transaction record (link to orderId)
    stmts.push(
      db
        .prepare(
          'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference_type, reference_id, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(
          userId,
          'purchase',
          -totalAmount,
          balanceBefore,
          balanceAfter,
          'order',
          orderId,
          `Mua ${quantity} sản phẩm`,
          'success',
          now
        )
    )

    let results: D1Result[]
    try {
      results = await db.batch(stmts)
    } catch {
      // Phase 2 failed — best-effort rollback the orphan order created in phase 1
      await db.prepare('DELETE FROM orders WHERE id = ?').bind(orderId).run().catch(() => {})
      return { success: false, error: 'db_error' }
    }

    // 5. Verify concurrency guard — balance update must have affected 1 row
    if (results[0].meta.changes === 0) {
      // Race: another purchase consumed balance. Rollback orphan order.
      await db.prepare('DELETE FROM orders WHERE id = ?').bind(orderId).run().catch(() => {})
      return { success: false, error: 'insufficient_balance' }
    }

    // 6. Verify all product UPDATEs succeeded (1..quantity slots after balance update)
    for (let i = 1; i <= availableProducts.length; i++) {
      if (results[i].meta.changes === 0) {
        // A product was sniped by a concurrent purchase. Best-effort cleanup.
        await db.prepare('DELETE FROM order_items WHERE order_id = ?').bind(orderId).run().catch(() => {})
        await db.prepare('DELETE FROM orders WHERE id = ?').bind(orderId).run().catch(() => {})
        return { success: false, error: 'insufficient_stock' }
      }
    }

    // 7. Build response — fetch created order
    const order = await db
      .prepare('SELECT * FROM orders WHERE id = ?')
      .bind(orderId)
      .first<DbOrder>()

    return {
      success: true,
      order: order ?? undefined,
      products: availableProducts,
    }
  }

  /**
   * Atomic deposit: add balance → update deposit status → create transaction.
   * Uses D1 batch for atomicity. Verifies deposit was in 'pending' status.
   */
  async executeDeposit(
    db: D1Database,
    depositId: number,
    userId: number,
    amount: number,
    sepayTxId: string
  ): Promise<DepositResult> {
    const now = new Date().toISOString()

    // 1. Query current user balance and deposit status
    const [userResult, depositResult] = await Promise.all([
      db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<DbUser>(),
      db
        .prepare('SELECT status FROM deposits WHERE id = ?')
        .bind(depositId)
        .first<{ status: string }>(),
    ])

    if (!userResult) {
      return { success: false, error: 'db_error' }
    }

    if (!depositResult) {
      return { success: false, error: 'not_found' }
    }

    if (depositResult.status === 'completed') {
      return { success: false, error: 'already_processed' }
    }

    if (depositResult.status === 'expired') {
      return { success: false, error: 'expired' }
    }

    if (depositResult.status !== 'pending') {
      return { success: false, error: 'not_found' }
    }

    const balanceBefore = userResult.balance
    const balanceAfter = balanceBefore + amount

    // 2. D1 batch — atomic operations
    const stmts: D1PreparedStatement[] = [
      // 2a. Add balance
      db
        .prepare('UPDATE users SET balance = ?, updated_at = ? WHERE id = ?')
        .bind(balanceAfter, now, userId),

      // 2b. Update deposit status (concurrency guard: only if still pending)
      db
        .prepare(
          "UPDATE deposits SET status = 'completed', sepay_transaction_id = ?, completed_at = ? WHERE id = ? AND status = 'pending'"
        )
        .bind(sepayTxId, now, depositId),

      // 2c. Create transaction record
      db
        .prepare(
          'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference_type, reference_id, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(
          userId,
          'deposit',
          amount,
          balanceBefore,
          balanceAfter,
          'deposit',
          depositId,
          `Nạp ${amount.toLocaleString('vi-VN')}đ`,
          'success',
          now
        ),
    ]

    let results: D1Result[]
    try {
      results = await db.batch(stmts)
    } catch {
      return { success: false, error: 'db_error' }
    }

    // 3. Verify deposit update affected rows (was truly in 'pending' state)
    if (results[1].meta.changes === 0) {
      return { success: false, error: 'already_processed' }
    }

    return {
      success: true,
      newBalance: balanceAfter,
    }
  }
}

export const transactionService = new TransactionService()
