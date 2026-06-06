-- =============================================
-- Telegram Shop Bot - Thêm tính năng ban user
-- Tận dụng cột is_active sẵn có làm cờ ban:
--   is_active = 1 -> hoạt động bình thường
--   is_active = 0 -> bị ban (chặn nhắn bot + thao tác Mini App)
-- banned_at lưu thời điểm khoá phục vụ lưu vết (không cần lý do).
-- =============================================

ALTER TABLE users ADD COLUMN banned_at TEXT;

-- Index lọc nhanh user bị ban (is_active = 0).
CREATE INDEX idx_users_is_active ON users(is_active);
