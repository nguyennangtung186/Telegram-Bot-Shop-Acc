-- =============================================
-- Telegram Shop Bot - Initial Database Schema
-- D1/SQLite Migration
-- =============================================

-- Bảng users: thông tin người dùng Telegram
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
  is_active INTEGER DEFAULT 1,
  last_interaction_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bảng product_types: danh mục loại sản phẩm
CREATE TABLE product_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL CHECK(price > 0),
  emoji TEXT DEFAULT '📦',
  sort_order INTEGER DEFAULT 0,
  is_visible INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bảng orders: đơn hàng
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  product_type_id INTEGER NOT NULL REFERENCES product_types(id),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  total_amount INTEGER NOT NULL,
  transaction_id INTEGER,
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','refunded')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bảng transactions: sổ cái giao dịch tài chính
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('deposit','purchase','refund','adjustment')),
  amount INTEGER NOT NULL,
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reference_type TEXT,
  reference_id INTEGER,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'success' CHECK(status IN ('success','failed','pending')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bảng products: sản phẩm cụ thể (tài khoản số)
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type_id INTEGER NOT NULL REFERENCES product_types(id),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','sold','reserved')),
  buyer_id INTEGER REFERENCES users(id),
  order_id INTEGER REFERENCES orders(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sold_at TEXT
);

-- Bảng order_items: chi tiết đơn hàng
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bảng deposits: yêu cầu nạp tiền qua SePay
CREATE TABLE deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  transfer_code TEXT UNIQUE NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','expired','cancelled')),
  sepay_transaction_id TEXT,
  bank_ref TEXT,
  completed_at TEXT,
  expired_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bảng admin_users: tài khoản admin cho CMS
CREATE TABLE admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  last_login_at TEXT,
  failed_login_count INTEGER DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bảng system_config: cấu hình hệ thống key-value
CREATE TABLE system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES admin_users(id)
);

-- Bảng audit_logs: nhật ký hành động admin
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL REFERENCES admin_users(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id INTEGER,
  old_value TEXT,
  new_value TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =============================================
-- INDEXES
-- =============================================

-- Users indexes
CREATE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_users_last_interaction ON users(last_interaction_at);

-- Products indexes
CREATE INDEX idx_products_type_status ON products(type_id, status);
CREATE INDEX idx_products_buyer ON products(buyer_id) WHERE buyer_id IS NOT NULL;
CREATE UNIQUE INDEX idx_products_content_type ON products(type_id, content);

-- Transactions indexes
CREATE INDEX idx_transactions_user_created ON transactions(user_id, created_at DESC);
CREATE INDEX idx_transactions_type_created ON transactions(type, created_at DESC);

-- Deposits indexes
CREATE INDEX idx_deposits_transfer_code ON deposits(transfer_code);
CREATE INDEX idx_deposits_user_status ON deposits(user_id, status);
CREATE INDEX idx_deposits_status_created ON deposits(status, created_at);

-- Orders indexes
CREATE INDEX idx_orders_user_created ON orders(user_id, created_at DESC);

-- Order items indexes
CREATE INDEX idx_order_items_order ON order_items(order_id);

-- Audit logs indexes
CREATE INDEX idx_audit_logs_admin_created ON audit_logs(admin_id, created_at DESC);

-- =============================================
-- DEFAULT DATA
-- =============================================

INSERT INTO system_config (key, value, description) VALUES
  ('shop_name', 'Telegram Shop Bot', 'Tên hiển thị của shop'),
  ('broadcast_enabled', 'true', 'Bật/tắt thông báo broadcast khi có đơn mới'),
  ('min_deposit', '20000', 'Số tiền nạp tối thiểu (VNĐ)'),
  ('max_deposit', '100000000', 'Số tiền nạp tối đa (VNĐ)'),
  ('maintenance_mode', 'false', 'Chế độ bảo trì hệ thống');
