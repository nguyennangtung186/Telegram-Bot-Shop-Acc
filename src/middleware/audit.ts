/**
 * Audit log utility — ghi nhận mọi CMS write operation (create, update, delete).
 * Được gọi trực tiếp từ mỗi CMS API handler khi có write operation.
 *
 * Lưu: admin_id, action, resource_type, resource_id, old_value, new_value, ip_address, created_at
 */

export interface AuditLogParams {
  adminId: number
  action: string // 'create' | 'update' | 'delete' | 'adjust_balance' | 'approve_deposit'
  resourceType: string // 'product_type' | 'product' | 'user' | 'deposit' | 'config'
  resourceId?: number
  oldValue?: string | null // JSON stringified old state
  newValue?: string | null // JSON stringified new state
  ipAddress?: string | null
}

/**
 * Ghi một bản ghi audit log vào database.
 * Sử dụng datetime('now') cho created_at.
 */
export async function writeAuditLog(
  db: D1Database,
  params: AuditLogParams
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_logs (admin_id, action, resource_type, resource_id, old_value, new_value, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .bind(
      params.adminId,
      params.action,
      params.resourceType,
      params.resourceId ?? null,
      params.oldValue ?? null,
      params.newValue ?? null,
      params.ipAddress ?? null
    )
    .run()
}
