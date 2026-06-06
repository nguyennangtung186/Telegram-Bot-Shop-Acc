-- =============================================
-- Thêm key cấu hình SePay API key vào system_config
-- Quản lý qua CMS (Cấu hình). Để trống => fallback secret SEPAY_API_KEY của Worker.
-- =============================================

INSERT INTO system_config (key, value, description) VALUES
  ('sepay_api_key', '', 'API key xac thuc webhook SePay (header Authorization: Apikey <key>). De trong se dung secret SEPAY_API_KEY cua Worker.')
ON CONFLICT(key) DO NOTHING;
