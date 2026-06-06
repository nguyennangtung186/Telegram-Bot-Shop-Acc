-- =============================================
-- Thêm cấu hình Telegram (bot_token, telegram_secret_token, admin_ids) vào system_config
-- Quản lý qua CMS (Cấu hình). Để trống => fallback secret/var tương ứng của Worker.
-- =============================================

INSERT INTO system_config (key, value, description) VALUES
  ('bot_token', '', 'Telegram Bot API token. De trong se dung secret BOT_TOKEN cua Worker.'),
  ('telegram_secret_token', '', 'Secret token xac thuc webhook Telegram (header X-Telegram-Bot-Api-Secret-Token). De trong se dung secret TELEGRAM_SECRET_TOKEN cua Worker.'),
  ('admin_ids', '', 'Danh sach Telegram ID admin, phan tach bang dau phay. De trong se dung var ADMIN_IDS cua Worker.')
ON CONFLICT(key) DO NOTHING;
