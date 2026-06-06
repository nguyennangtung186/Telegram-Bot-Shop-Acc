import { Hono } from 'hono'
import type { Bindings } from '../../types'
import type { AdminVariables } from '../../middleware/jwt-auth'
import { jwtAuth } from '../../middleware/jwt-auth'

type ConfigEnv = {
  Bindings: Bindings
  Variables: AdminVariables
}

interface SystemConfigRow {
  key: string
  value: string
  description: string | null
  updated_at: string
  updated_by: number | null
}

const configRoutes = new Hono<ConfigEnv>()

// All config routes require JWT auth
configRoutes.use('/*', jwtAuth)

/**
 * GET /config
 * Return all system_config rows as key-value object.
 * Requirements: 11.10, 13.1
 */
configRoutes.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT key, value, description, updated_at, updated_by FROM system_config'
  ).all<SystemConfigRow>()

  // Build key-value map
  const configs: Record<string, string> = {}
  for (const row of rows.results) {
    configs[row.key] = row.value
  }

  // Hiển thị GIÁ TRỊ HIỆU LỰC (DB-first, fallback env): với các key được backing bằng
  // secret/var của Worker, nếu DB trống thì điền giá trị env để CMS không hiển thị trống
  // và admin có thể lưu lại (promote env -> DB). Khớp logic resolve ở runtime.
  const envFallback: Record<string, string | undefined> = {
    bank_name: c.env.BANK_NAME,
    bank_account: c.env.BANK_ACCOUNT,
    bank_owner: c.env.BANK_OWNER,
    bot_token: c.env.BOT_TOKEN,
    telegram_secret_token: c.env.TELEGRAM_SECRET_TOKEN,
    admin_ids: c.env.ADMIN_IDS,
    sepay_api_key: c.env.SEPAY_API_KEY,
  }
  for (const [key, envValue] of Object.entries(envFallback)) {
    const current = configs[key]
    if ((current === undefined || current.trim() === '') && envValue && envValue.trim() !== '') {
      configs[key] = envValue
    }
  }

  return c.json({
    success: true,
    data: { configs },
    error: null,
  })
})

/**
 * PUT /config
 * Body: { configs: { key: value, ... } }
 * Update each config key's value and updated_at.
 * Write audit_log for each changed key (old_value → new_value).
 * Requirements: 11.10, 13.1
 */
configRoutes.put('/', async (c) => {
  const body = await c.req.json<{ configs?: Record<string, string> }>()

  if (!body.configs || typeof body.configs !== 'object') {
    return c.json(
      { success: false, data: null, error: 'Field "configs" is required and must be an object' },
      400
    )
  }

  const adminId = c.get('adminId')
  const now = new Date().toISOString()
  const entries = Object.entries(body.configs)

  if (entries.length === 0) {
    return c.json({
      success: true,
      data: { updated: 0 },
      error: null,
    })
  }

  // Fetch current values for audit log comparison
  const keys = entries.map(([k]) => k)
  const placeholders = keys.map(() => '?').join(', ')
  const currentRows = await c.env.DB.prepare(
    `SELECT key, value FROM system_config WHERE key IN (${placeholders})`
  ).bind(...keys).all<{ key: string; value: string }>()

  const currentMap = new Map<string, string>()
  for (const row of currentRows.results) {
    currentMap.set(row.key, row.value)
  }

  // Build batch statements: update configs + insert audit logs
  const stmts: D1PreparedStatement[] = []
  let updatedCount = 0

  for (const [key, newValue] of entries) {
    const oldValue = currentMap.get(key)

    // Only update if key exists and value actually changed
    if (oldValue === undefined) {
      // Key doesn't exist — skip or insert (we'll do upsert)
      // Use INSERT OR REPLACE to support new keys as well
      stmts.push(
        c.env.DB.prepare(
          'INSERT OR REPLACE INTO system_config (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)'
        ).bind(key, String(newValue), now, adminId)
      )
      // Audit log for new key
      stmts.push(
        c.env.DB.prepare(
          'INSERT INTO audit_logs (admin_id, action, resource_type, resource_id, old_value, new_value, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(adminId, 'update', 'system_config', null, null, String(newValue), null, now)
      )
      updatedCount++
    } else if (oldValue !== String(newValue)) {
      // Value changed — update
      stmts.push(
        c.env.DB.prepare(
          'UPDATE system_config SET value = ?, updated_at = ?, updated_by = ? WHERE key = ?'
        ).bind(String(newValue), now, adminId, key)
      )
      // Audit log for changed value
      stmts.push(
        c.env.DB.prepare(
          'INSERT INTO audit_logs (admin_id, action, resource_type, resource_id, old_value, new_value, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(adminId, 'update', 'system_config', null, oldValue, String(newValue), null, now)
      )
      updatedCount++
    }
    // If value unchanged — skip
  }

  if (stmts.length > 0) {
    await c.env.DB.batch(stmts)
  }

  return c.json({
    success: true,
    data: { updated: updatedCount },
    error: null,
  })
})

export { configRoutes }
