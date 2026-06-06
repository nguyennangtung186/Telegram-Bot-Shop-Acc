import { Hono } from 'hono'
import type { Bindings } from '../../types'
import type { AdminVariables } from '../../middleware/jwt-auth'
import { jwtAuth } from '../../middleware/jwt-auth'

type AdminEnv = {
  Bindings: Bindings
  Variables: AdminVariables
}

const transactionRoutes = new Hono<AdminEnv>()

// Apply JWT auth to all transaction routes
transactionRoutes.use('/*', jwtAuth)

/**
 * GET /transactions
 * List transactions with pagination + filters: type, date range (from/to), user_id.
 * JOIN users for username display.
 * Requirements: 11.8, 13.1, 13.3
 */
transactionRoutes.get('/', async (c) => {
  const page = Math.max(1, Number(c.req.query('page') || '1'))
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || '20')))
  const offset = (page - 1) * limit
  const sort = c.req.query('sort') || 'created_at'
  const order = c.req.query('order') === 'asc' ? 'ASC' : 'DESC'

  // Filters
  const type = c.req.query('filter[type]') || c.req.query('type')
  const dateFrom = c.req.query('filter[from]') || c.req.query('from')
  const dateTo = c.req.query('filter[to]') || c.req.query('to')
  const userId = c.req.query('filter[user_id]') || c.req.query('user_id')

  // Validate sort field
  const allowedSorts = ['created_at', 'amount', 'type', 'id']
  const sortField = allowedSorts.includes(sort) ? `t.${sort}` : 't.created_at'

  // Build WHERE clause
  const conditions: string[] = []
  const bindings: unknown[] = []

  if (type) {
    conditions.push('t.type = ?')
    bindings.push(type)
  }
  if (dateFrom) {
    conditions.push('t.created_at >= ?')
    bindings.push(dateFrom)
  }
  if (dateTo) {
    conditions.push('t.created_at <= ?')
    bindings.push(dateTo)
  }
  if (userId) {
    conditions.push('t.user_id = ?')
    bindings.push(Number(userId))
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // Count total
  const countSql = `SELECT COUNT(*) as total FROM transactions t ${whereClause}`
  const countResult = await c.env.DB.prepare(countSql).bind(...bindings).first<{ total: number }>()
  const total = countResult?.total || 0

  // Fetch transactions with user JOIN
  const dataSql = `
    SELECT 
      t.id, t.user_id, t.type, t.amount, t.balance_before, t.balance_after,
      t.reference_type, t.reference_id, t.description, t.status, t.created_at,
      u.telegram_id, u.username, u.first_name
    FROM transactions t
    LEFT JOIN users u ON t.user_id = u.id
    ${whereClause}
    ORDER BY ${sortField} ${order}
    LIMIT ? OFFSET ?
  `
  const dataBindings = [...bindings, limit, offset]
  const { results } = await c.env.DB.prepare(dataSql).bind(...dataBindings).all()

  return c.json({
    success: true,
    data: results || [],
    error: null,
    meta: { total, page, limit },
  })
})

/**
 * GET /transactions/export
 * Export transactions as CSV. Same filters as list.
 * Content-Type: text/csv with Content-Disposition header.
 * Requirements: 11.8, 13.3
 */
transactionRoutes.get('/export', async (c) => {
  // Filters (same as list)
  const type = c.req.query('filter[type]') || c.req.query('type')
  const dateFrom = c.req.query('filter[from]') || c.req.query('from')
  const dateTo = c.req.query('filter[to]') || c.req.query('to')
  const userId = c.req.query('filter[user_id]') || c.req.query('user_id')

  // Build WHERE clause
  const conditions: string[] = []
  const bindings: unknown[] = []

  if (type) {
    conditions.push('t.type = ?')
    bindings.push(type)
  }
  if (dateFrom) {
    conditions.push('t.created_at >= ?')
    bindings.push(dateFrom)
  }
  if (dateTo) {
    conditions.push('t.created_at <= ?')
    bindings.push(dateTo)
  }
  if (userId) {
    conditions.push('t.user_id = ?')
    bindings.push(Number(userId))
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // Fetch all matching transactions (no pagination for export)
  const dataSql = `
    SELECT 
      t.id, t.user_id, t.type, t.amount, t.balance_before, t.balance_after,
      t.reference_type, t.reference_id, t.description, t.status, t.created_at,
      u.telegram_id, u.username, u.first_name
    FROM transactions t
    LEFT JOIN users u ON t.user_id = u.id
    ${whereClause}
    ORDER BY t.created_at DESC
  `
  const { results } = await c.env.DB.prepare(dataSql).bind(...bindings).all()
  const rows = results || []

  // Build CSV
  const csvHeader = 'ID,User ID,Telegram ID,Username,Type,Amount,Balance Before,Balance After,Reference Type,Reference ID,Description,Status,Created At'
  const csvRows = rows.map((r: any) => {
    const description = r.description ? `"${String(r.description).replace(/"/g, '""')}"` : ''
    const username = r.username ? `"${String(r.username).replace(/"/g, '""')}"` : ''
    return [
      r.id,
      r.user_id,
      r.telegram_id || '',
      username,
      r.type,
      r.amount,
      r.balance_before,
      r.balance_after,
      r.reference_type || '',
      r.reference_id || '',
      description,
      r.status,
      r.created_at,
    ].join(',')
  })

  const csv = [csvHeader, ...csvRows].join('\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="transactions_${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
})

export { transactionRoutes }
