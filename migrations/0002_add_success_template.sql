-- =============================================
-- Thêm trường success_template cho product_types
-- Cho phép admin tuỳ biến tin nhắn "Mua hàng thành công" theo từng loại sản phẩm.
-- NULL/empty → dùng template mặc định trong code.
-- =============================================

ALTER TABLE product_types ADD COLUMN success_template TEXT;
