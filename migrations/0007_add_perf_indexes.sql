-- =============================================
-- Bo sung index cho cac duong nong con thieu.
--   1. deposits.sepay_transaction_id: webhook SePay chay idempotency check
--      "SELECT id FROM deposits WHERE sepay_transaction_id = ?" moi giao dich
--      ngan hang toi. Partial index (chi index ban ghi da gan txid) de nho gon.
--   2. orders(status, created_at): dashboard/revenue loc "status='completed'
--      AND created_at >= ?" va group theo ngay.
--   3. orders(product_type_id): top-products va dashboard group theo loai san pham.
-- =============================================

CREATE INDEX IF NOT EXISTS idx_deposits_sepay_txid
  ON deposits(sepay_transaction_id)
  WHERE sepay_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_status_created
  ON orders(status, created_at);

CREATE INDEX IF NOT EXISTS idx_orders_product_type
  ON orders(product_type_id);
