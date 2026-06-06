/**
 * DB model types — mapping 1:1 với D1/SQLite schema.
 * INTEGER cho monetary values (VNĐ, không thập phân).
 * TEXT ISO 8601 UTC cho timestamps.
 */

export interface DbUser {
  id: number
  telegram_id: number
  username: string | null
  first_name: string | null
  balance: number
  is_active: number // 0 | 1
  last_interaction_at: string | null
  created_at: string
  updated_at: string
}

export interface DbProductType {
  id: number
  name: string
  description: string | null
  price: number
  emoji: string
  sort_order: number
  is_visible: number // 0 | 1
  success_template: string | null
  created_at: string
  updated_at: string
}

export interface DbProduct {
  id: number
  type_id: number
  content: string
  status: 'available' | 'sold' | 'reserved'
  buyer_id: number | null
  order_id: number | null
  created_at: string
  sold_at: string | null
}

export interface DbOrder {
  id: number
  user_id: number
  product_type_id: number
  quantity: number
  total_amount: number
  transaction_id: number | null
  status: 'completed' | 'refunded'
  created_at: string
}

export interface DbOrderItem {
  id: number
  order_id: number
  product_id: number
  created_at: string
}

export interface DbTransaction {
  id: number
  user_id: number
  type: 'deposit' | 'purchase' | 'refund' | 'adjustment'
  amount: number
  balance_before: number
  balance_after: number
  reference_type: string | null
  reference_id: number | null
  description: string | null
  status: 'success' | 'failed' | 'pending'
  created_at: string
}

export interface DbDeposit {
  id: number
  user_id: number
  transfer_code: string
  amount: number
  status: 'pending' | 'completed' | 'expired' | 'cancelled'
  sepay_transaction_id: string | null
  bank_ref: string | null
  completed_at: string | null
  expired_at: string | null
  created_at: string
}

export interface DbAdminUser {
  id: number
  username: string
  password_hash: string
  display_name: string | null
  last_login_at: string | null
  failed_login_count: number
  locked_until: string | null
  created_at: string
}

export interface DbSystemConfig {
  key: string
  value: string
  description: string | null
  updated_at: string
  updated_by: number | null
}

export interface DbAuditLog {
  id: number
  admin_id: number
  action: string
  resource_type: string
  resource_id: number | null
  old_value: string | null
  new_value: string | null
  ip_address: string | null
  created_at: string
}
