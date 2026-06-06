-- =============================================
-- Gỡ tính năng Broadcast FOMO
-- Xoá config key 'broadcast_enabled' khỏi system_config
-- =============================================

DELETE FROM system_config WHERE key = 'broadcast_enabled';
