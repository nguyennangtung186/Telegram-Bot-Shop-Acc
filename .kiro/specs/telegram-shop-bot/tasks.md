# Implementation Plan: Telegram Shop Bot

## Overview

Triển khai hệ thống bot Telegram bán tài khoản số trên Cloudflare Workers (Hono framework), tích hợp thanh toán SePay và quản trị qua CMS Vue 3. Implementation chia thành các giai đoạn: setup project → database → core services → bot handlers → webhooks → CMS API → CMS frontend.

## Tasks

- [x] 1. Khởi tạo project và cấu trúc cơ bản
  - [x] 1.1 Khởi tạo Cloudflare Worker project với Hono framework
    - Tạo `wrangler.toml` với D1 binding, environment variables
    - Tạo `package.json` với dependencies: hono, jose, bcryptjs, vitest, fast-check, @cloudflare/vitest-pool-workers
    - Tạo `tsconfig.json` với cấu hình cho Cloudflare Workers
    - Tạo cấu trúc thư mục: `src/`, `src/routes/`, `src/bot/`, `src/services/`, `src/middleware/`, `src/utils/`, `src/types/`, `test/`
    - _Requirements: 8.3, 14.1_

  - [x] 1.2 Tạo type definitions và interfaces
    - Định nghĩa `Bindings` type cho Hono (DB, BOT_TOKEN, TELEGRAM_SECRET_TOKEN, SEPAY_API_KEY, ADMIN_IDS, JWT_SECRET, BROADCAST_ENABLED, BANK_NAME, BANK_ACCOUNT, BANK_OWNER)
    - Định nghĩa interfaces: `TelegramUpdate`, `Message`, `CallbackQuery`, `SepayWebhookPayload`
    - Định nghĩa DB model types: `DbUser`, `DbProductType`, `DbProduct`, `DbOrder`, `DbTransaction`, `DbDeposit`, `DbAdminUser`, `DbAuditLog`
    - Định nghĩa `ApiResponse<T>`, `PaginationParams`
    - _Requirements: 14.1, 13.4_

  - [x] 1.3 Tạo main entry point (`src/index.ts`) với Hono router
    - Mount routes: `/webhook/telegram`, `/webhook/sepay`, `/api/admin/*`, `/cms/*`
    - Fallback 404 cho path không đăng ký
    - _Requirements: 8.7, 13.1_

- [x] 2. Database schema và migration
  - [x] 2.1 Tạo D1 migration file với toàn bộ schema
    - Tạo file `migrations/0001_initial_schema.sql`
    - Tạo tất cả bảng: users, product_types, products, orders, order_items, transactions, deposits, admin_users, system_config, audit_logs
    - Tạo tất cả indexes theo design
    - Tạo unique constraint `idx_products_content_type` trên products(type_id, content)
    - Insert default system_config records
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 14.11, 14.12, 14.13, 14.14, 14.15_

- [x] 3. Core services và utilities
  - [x] 3.1 Implement utility functions cơ bản
    - `src/utils/error-handler.ts`: AppError class, handleBotError, handleApiError
    - `src/utils/retry.ts`: d1WithRetry (retry 2 lần, delay 500ms)
    - `src/utils/format.ts`: formatCurrency, formatDate (DD/MM/YYYY HH:mm), maskUsername (4 ký tự đầu + '****')
    - `src/utils/transfer-code.ts`: generateTransferCode(userId) → "NAP" + 4 digit + 6 random chars
    - `src/utils/vietqr.ts`: generateVietQRUrl(params) → img.vietqr.io URL
    - _Requirements: 2.4, 9.1, 9.2, 9.3, 10.1_

  - [x] 3.2 Property tests cho utility functions
    - **Property 6: Transfer code format và uniqueness** — generateTransferCode tạo string 6-20 chars, có prefix NAP, kết quả khác nhau mỗi lần gọi
    - **Property 13: Username masking** — giữ 4 ký tự đầu + '****', username < 4 chars hiển thị toàn bộ + '****'
    - **Property 15: Admin ID check** — isAdmin trả về true khi telegram_id trong ADMIN_IDS, false khi không
    - **Property 20: VietQR URL generation** — URL chứa bank identifier, account number, amount, transfer content
    - **Validates: Requirements 2.4, 10.1, 8.6, 2.2**

  - [x] 3.3 Implement Transaction Service
    - `src/services/transaction.ts`: class TransactionService
    - Method `executePurchase(db, userId, categoryId, quantity, unitPrice)`: D1 batch atomic — check balance, deduct, mark products sold (theo created_at ASC), create order + order_items, create transaction
    - Method `executeDeposit(db, depositId, userId, amount, sepayTxId)`: D1 batch atomic — add balance, update deposit status, create transaction
    - Concurrency check: verify `meta.changes > 0` sau UPDATE balance
    - _Requirements: 3.7, 4.1, 4.2, 4.3, 4.4, 4.9_

  - [x] 3.4 Property tests cho Transaction Service
    - **Property 1: Balance không bao giờ âm** — mọi sequence operations, balance >= 0
    - **Property 2: Deposit cộng chính xác số tiền** — balance_after = balance_before + amount
    - **Property 4: Atomic purchase consistency** — balance giảm đúng, đúng quantity products sold, order đúng
    - **Property 5: Mỗi thay đổi balance có transaction record** — balance_after - balance_before = amount
    - **Validates: Requirements 4.9, 3.7, 4.5, 2.6, 4.4, 4.1, 4.3, 4.2**

  - [x] 3.5 Implement Broadcast Service
    - `src/services/broadcast.ts`: class BroadcastService
    - Rate limiter: max 1 broadcast / 30 giây (in-memory timestamp)
    - Query active users (last_interaction_at within 7 days)
    - Format broadcast message: "🎉 VỪA CÓ ĐƠN MỚI!" + masked username + category + qty + price
    - CTA buttons: "🛒 Mua [category]" và "💰 Nạp tiền"
    - Check BROADCAST_ENABLED env var
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 3.6 Property test cho Broadcast Service
    - **Property 14: Broadcast rate limiting** — hai purchases < 30s cách nhau, chỉ 1 broadcast gửi đi
    - **Validates: Requirements 10.5**

  - [x] 3.7 Implement Session Manager
    - `src/bot/session.ts`: UserSession interface, in-memory Map<number, UserSession>
    - Flow types: deposit, admin_add_type, admin_edit_type, admin_add_product
    - Auto-expire sau 5 phút
    - Methods: getSession, setSession, clearSession, isSessionExpired
    - _Requirements: 9.4_

- [x] 4. Middleware authentication
  - [x] 4.1 Implement Telegram webhook authentication middleware
    - `src/middleware/telegram-auth.ts`: kiểm tra header X-Telegram-Bot-Api-Secret-Token
    - Return 401 nếu không khớp TELEGRAM_SECRET_TOKEN
    - _Requirements: 8.1, 8.4_

  - [x] 4.2 Implement SePay webhook authentication middleware
    - `src/middleware/sepay-auth.ts`: parse header `Authorization: Apikey {key}`
    - Return 401 nếu không khớp SEPAY_API_KEY
    - _Requirements: 8.2, 8.5_

  - [x] 4.3 Implement JWT authentication middleware cho CMS
    - `src/middleware/jwt-auth.ts`: parse Bearer token, verify bằng jose jwtVerify
    - Set adminId và adminUsername vào context
    - Return 401 nếu token expired hoặc invalid
    - _Requirements: 12.5, 12.6_

  - [x] 4.4 Implement password hashing utilities
    - `src/utils/auth.ts`: hashPassword (bcryptjs, cost=10), verifyPassword
    - _Requirements: 12.2_

  - [x] 4.5 Property test cho password hashing
    - **Property 18: Password hash round-trip** — hashPassword + verifyPassword đúng, wrong password trả false
    - **Validates: Requirements 12.2**

- [x] 5. Checkpoint - Core services hoàn tất
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Telegram Bot handlers
  - [x] 6.1 Implement Telegram API helper
    - `src/bot/telegram-api.ts`: sendMessage, editMessageText, sendPhoto, answerCallbackQuery
    - Xây dựng InlineKeyboard builder utility
    - Reply keyboard builder cho menu chính
    - Fallback: nếu editMessage fail → sendMessage mới
    - _Requirements: 7.3, 7.6, 7.9_

  - [x] 6.2 Implement /start command và menu chính
    - `src/bot/commands/start.ts`
    - Tạo user mới nếu chưa có (telegram_id, username, first_name, balance=0)
    - Cập nhật username/first_name nếu đã có
    - Cập nhật last_interaction_at
    - Hiển thị Reply Keyboard cố định: "🛒 Mua hàng", "💰 Nạp tiền", "📜 Lịch sử", "👤 Số dư"
    - Gửi tin nhắn chào mừng kèm tên shop, lời chào, số dư
    - Xử lý lỗi D1 → thông báo lỗi cho user
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 7.1, 7.2, 7.10_

  - [x] 6.3 Implement flow mua hàng (Purchase)
    - `src/bot/callbacks/purchase.ts`
    - `cat:list` → hiển thị categories có product available (name, price, stock), phân trang 5 items/page
    - `cat:{id}` → chi tiết category + grid số lượng 1-10 (5×2)
    - `qty:{catId}:{qty}` → hiển thị tổng tiền + nút "✅ Xác nhận mua"
    - `buy:{catId}:{qty}` → gọi TransactionService.executePurchase → gửi product contents
    - Xử lý: balance không đủ → thông báo + nút nạp tiền
    - Xử lý: stock không đủ → thông báo số còn lại
    - Hỗ trợ nhập số lượng tự do qua text message (1-50, integer)
    - Nút "🔙 Quay lại" mỗi màn hình
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 7.5, 7.6, 7.7_

  - [x] 6.4 Property tests cho purchase validation
    - **Property 7: Category chỉ hiển thị khi có stock** — categories list chỉ gồm category có product available
    - **Property 9: Quantity validation** — reject input ≤ 0, non-integer, > 50; báo stock thực tế nếu vượt
    - **Validates: Requirements 3.1, 3.5, 3.6**

  - [x] 6.5 Implement flow nạp tiền (Deposit)
    - `src/bot/callbacks/deposit.ts`
    - `dep:menu` → hiển thị grid mệnh giá (30k, 50k, 100k, 200k, 500k, 1M) 2×3 + hướng dẫn
    - `dep:{amount}` hoặc text input → tạo deposit pending + generate transfer code + gửi QR VietQR
    - Hiển thị: QR ảnh, tên NH, số TK, chủ TK, số tiền, nội dung CK, cảnh báo
    - Nút "❌ Huỷ" → cancel deposit, quay menu chính
    - Hỗ trợ nhập số tiền tùy ý (min 20,000đ)
    - Lệnh /huy → huỷ deposit đang chờ
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.13, 7.3_

  - [x] 6.6 Implement xem lịch sử và tài khoản
    - `src/bot/callbacks/history.ts`: hiển thị 10 orders gần nhất (tên category, qty, total, datetime DD/MM/YYYY HH:mm)
    - `src/bot/callbacks/account.ts`: hiển thị username, first_name, balance, tổng transactions, ngày tham gia
    - Thông báo "chưa có đơn hàng" nếu không có order
    - _Requirements: 4.7, 4.8, 1.4_

  - [x] 6.7 Property test cho order history
    - **Property 8: Order history sắp xếp đúng và giới hạn** — max 10 items, sorted DESC by created_at
    - **Validates: Requirements 4.7**

  - [x] 6.8 Implement Admin bot commands
    - `src/bot/commands/admin.ts`
    - Kiểm tra isAdmin trước khi cho truy cập
    - `/admin` → bảng điều khiển: "➕ Thêm loại", "📋 Danh sách loại", "➕ Thêm sản phẩm", "📊 Thống kê"
    - Thêm loại: flow multi-step (tên → mô tả → giá) → create category
    - Sửa loại: hiển thị giá trị hiện tại, nhập mới từng trường
    - Xoá loại: xác nhận, reject nếu còn product available
    - Danh sách loại: phân trang 20 items, nút Sửa/Xoá
    - Thêm sản phẩm: chọn category → nhập content (bulk, mỗi dòng 1 product, max 50)
    - Thống kê: tổng user, doanh thu, products sold/remaining per category
    - /cancel huỷ flow admin bất kỳ lúc nào
    - Validation: tên 1-100 chars, mô tả 0-500 chars, giá 1000-999999999
    - Non-admin gửi /admin → thông báo không có quyền
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 6.9 Property tests cho admin validation
    - **Property 10: Category validation với error message cụ thể** — reject với error chỉ rõ trường lỗi, accept input hợp lệ
    - **Property 11: Bulk product insert atomicity** — N unique contents tạo N products, 1 lỗi rollback tất cả
    - **Property 12: Product content uniqueness per category** — reject duplicate content cùng category
    - **Validates: Requirements 5.2, 5.3, 6.3, 6.5, 6.4**

  - [x] 6.10 Implement callback router và text message router
    - `src/bot/router.ts`: parse callback_data format "action:param1:param2", dispatch tới handler tương ứng
    - Xử lý text messages: detect flow context (session), route input text tương ứng
    - Xử lý reply keyboard buttons: "🛒 Mua hàng" → cat:list, "💰 Nạp tiền" → dep:menu, etc.
    - Xử lý callback_query invalid/hết hạn → thông báo lỗi + menu chính
    - _Requirements: 7.4, 7.8_

- [x] 7. Checkpoint - Bot handlers hoàn tất
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Webhook routes
  - [x] 8.1 Implement Telegram webhook route
    - `src/routes/telegram.ts`: POST /webhook/telegram
    - Apply telegram-auth middleware
    - Parse TelegramUpdate → identify command/callback/text
    - Dispatch tới router
    - Update last_interaction_at cho user
    - Error handling: catch all → handleBotError
    - _Requirements: 8.1, 8.4, 9.1, 9.3_

  - [x] 8.2 Implement SePay webhook route
    - `src/routes/sepay.ts`: POST /webhook/sepay
    - Apply sepay-auth middleware
    - Validate: chỉ xử lý transferType = 'in'
    - Idempotency: check sepay_transaction_id đã xử lý chưa (payload.id)
    - Extract transfer_code từ content (regex: NAP[A-Z0-9]{4,17})
    - Find pending deposit by transfer_code
    - Validate amount range (20,000 - 100,000,000)
    - Gọi TransactionService.executeDeposit
    - Gửi notification cho user (waitUntil async)
    - Trigger broadcast (waitUntil async)
    - Luôn return `{"success": true}` + HTTP 200 (trừ auth fail → 401)
    - _Requirements: 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 8.2, 8.5_

  - [x] 8.3 Property test cho SePay webhook
    - **Property 3: Deposit webhook idempotence** — cùng webhook gửi lại không thay đổi balance, return HTTP 200
    - **Validates: Requirements 2.10**

- [x] 9. CMS API Backend
  - [x] 9.1 Implement CMS auth endpoints
    - `src/routes/admin/auth.ts`: POST /api/admin/auth/login, POST /api/admin/auth/refresh, GET /api/admin/auth/me
    - Login: validate credentials, check lockout (5 fail / 15 min → block 30 min), create JWT (24h)
    - Reset failed_login_count on success, increment on failure
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.8_

  - [x] 9.2 Implement CMS Users API
    - `src/routes/admin/users.ts`: GET /api/admin/users, GET /api/admin/users/:id, POST /api/admin/users/:id/adjust-balance
    - List: phân trang, search by username/telegram_id
    - Detail: balance, transaction history, order history
    - Adjust balance: kèm reason, tạo transaction type=adjustment, ghi audit log
    - _Requirements: 11.3, 13.1, 13.2, 13.3, 13.8_

  - [x] 9.3 Implement CMS Product Types API
    - `src/routes/admin/product-types.ts`: full CRUD
    - GET list, POST create, PUT update, DELETE (reject if available products exist)
    - Validation: name 1-100, description 0-500, price 1000-999999999
    - Ghi audit log mọi action
    - _Requirements: 11.4, 13.1, 13.2, 13.5_

  - [x] 9.4 Implement CMS Products API
    - `src/routes/admin/products.ts`: GET list (filter category, status), POST /import, DELETE /:id
    - Import: body {category_id, contents[]}, check duplicates per category, D1 batch insert, return {imported, duplicates, errors}
    - Delete: chỉ cho phép status=available
    - _Requirements: 11.5, 11.6, 13.1, 13.9_

  - [x] 9.5 Implement CMS Orders & Transactions API
    - `src/routes/admin/orders.ts`: GET list (filter status, category, date), GET /:id (detail + items)
    - `src/routes/admin/transactions.ts`: GET list (filter type, date range), GET /export (CSV)
    - _Requirements: 11.7, 11.8, 13.1, 13.3_

  - [x] 9.6 Implement CMS Deposits API
    - `src/routes/admin/deposits.ts`: GET list (filter status), POST /:id/approve
    - Approve: manual fallback khi webhook miss — gọi TransactionService.executeDeposit
    - Ghi audit log
    - _Requirements: 11.9, 13.10_

  - [x] 9.7 Implement CMS Stats & Dashboard API
    - `src/routes/admin/stats.ts`
    - GET /api/admin/stats/dashboard: tổng doanh thu (today, 7d, 30d, all), tổng user, tổng orders, products remaining per category
    - GET /api/admin/stats/revenue?from=&to=: doanh thu theo ngày cho chart
    - GET /api/admin/stats/top-products: top bán chạy
    - GET /api/admin/stats/top-users: top users mua nhiều
    - _Requirements: 11.2, 11.11, 13.6, 13.7_

  - [x] 9.8 Implement CMS Config API
    - `src/routes/admin/config.ts`: GET /api/admin/config, PUT /api/admin/config
    - Update batch, ghi audit log
    - _Requirements: 11.10, 13.1_

  - [x] 9.9 Implement audit log middleware
    - `src/middleware/audit.ts`: auto-log mọi CMS write operation (create, update, delete)
    - Lưu: admin_id, action, resource_type, resource_id, old_value, new_value, ip_address
    - _Requirements: 12.7_

  - [x] 9.10 Property tests cho CMS API
    - **Property 17: API response format chuẩn** — mọi response có success, data, error; success=true → error=null; success=false → data=null
    - **Property 19: Audit log cho mọi admin action** — mỗi CMS write operation tạo audit_log record đúng
    - **Validates: Requirements 13.4, 12.7**

- [x] 10. Checkpoint - Backend API hoàn tất
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. CMS Frontend (Vue 3)
  - [x] 11.1 Khởi tạo Vue 3 project
    - Tạo `cms/` directory với Vite + Vue 3 (Composition API + script setup)
    - Setup router (vue-router), state management (nếu cần)
    - Cấu hình Vite build output vào `dist/cms/` để Worker serve static
    - Responsive layout base (sidebar + content)
    - _Requirements: 11.1, 11.12_

  - [x] 11.2 Implement trang Login
    - Form username/password
    - Gọi POST /api/admin/auth/login
    - Lưu JWT token, redirect về Dashboard
    - Auto-redirect về login khi 401
    - _Requirements: 12.1, 12.4, 12.5_

  - [x] 11.3 Implement trang Dashboard
    - Hiển thị: tổng doanh thu (today/7d/30d/all), tổng user, tổng orders, products per category
    - Line chart doanh thu theo ngày (chart library: Chart.js hoặc ECharts)
    - _Requirements: 11.2_

  - [x] 11.4 Implement trang Users
    - Danh sách phân trang, search username/telegram_id
    - Chi tiết user: balance, transactions, orders
    - Nút điều chỉnh balance (modal: amount + reason)
    - _Requirements: 11.3_

  - [x] 11.5 Implement trang Categories
    - CRUD categories: tên, mô tả, giá, emoji
    - Toggle is_visible
    - Drag & drop sắp xếp sort_order
    - _Requirements: 11.4_

  - [x] 11.6 Implement trang Products
    - Danh sách filter theo category, status
    - Xem buyer info cho product sold
    - Delete product available
    - Import hàng loạt: textarea + upload TXT + preview + confirm
    - _Requirements: 11.5, 11.6_

  - [x] 11.7 Implement trang Orders & Transactions
    - Orders: filter status/category/date, detail view
    - Transactions: filter type/date, export CSV
    - _Requirements: 11.7, 11.8_

  - [x] 11.8 Implement trang Deposits
    - Danh sách filter status
    - Nút duyệt thủ công deposit pending
    - Chi tiết với mã chuyển khoản
    - _Requirements: 11.9_

  - [x] 11.9 Implement trang Config & Reports
    - Config: form thông tin ngân hàng, broadcast toggle, min/max deposit, admin IDs, shop name
    - Reports: revenue by date range, top products, top users, charts
    - _Requirements: 11.10, 11.11_

  - [x] 11.10 Implement static asset serving từ Worker
    - `src/routes/static.ts`: serve Vue build assets tại /cms/*
    - SPA fallback: mọi route /cms/* trả về index.html
    - Cache headers cho static assets
    - _Requirements: 11.1_

- [x] 12. Checkpoint - CMS hoàn tất
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Pagination, error handling và deposit expiry
  - [x] 13.1 Implement pagination cho bot inline keyboards
    - `src/bot/utils/pagination.ts`: build page navigation buttons (⬅️ Trước / ➡️ Sau)
    - Trang đầu ẩn "⬅️ Trước", trang cuối ẩn "➡️ Sau"
    - Page size: 5 items cho bot
    - _Requirements: 7.7_

  - [x] 13.2 Property test cho pagination
    - **Property 16: Pagination hiển thị đúng nút điều hướng** — N>5 items: trang 1 ẩn Trước, trang cuối ẩn Sau, giữa hiện cả hai
    - **Validates: Requirements 7.7**

  - [x] 13.3 Implement deposit expiry logic
    - Scheduled handler hoặc check-on-access: deposits pending > 60 phút → status = 'expired'
    - Cron trigger trong wrangler.toml nếu dùng scheduled
    - _Requirements: 2.11_

- [x] 14. Final integration và wiring
  - [x] 14.1 Wire tất cả components trong main entry point
    - Đảm bảo mọi route đã mount đúng
    - Verify error handling global
    - Verify middleware chain: auth → handler
    - Test flow end-to-end: /start → mua hàng → purchase → broadcast
    - Test flow: nạp tiền → webhook SePay → balance update → notification
    - _Requirements: 1.1, 2.6, 3.7, 8.7_

  - [x] 14.2 Integration tests
    - Test full purchase flow với D1
    - Test full deposit flow (webhook → balance update)
    - Test JWT auth flow (login → protected route → expired token)
    - Test broadcast gửi notification sau purchase
    - _Requirements: 4.3, 4.4, 2.6, 12.3_

- [x] 15. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties từ design document (20 properties)
- Unit tests validate specific examples and edge cases
- Tech stack: Cloudflare Workers + Hono + D1 + Vue 3 + vitest + fast-check
- TypeScript throughout (backend + frontend)
- D1 batch() cho atomic multi-table writes
- In-memory session cho short-lived flows (< 5 min)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["1.3", "3.1", "3.7"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.5", "4.1", "4.2", "4.3", "4.4"] },
    { "id": 4, "tasks": ["3.4", "3.6", "4.5", "6.1"] },
    { "id": 5, "tasks": ["6.2", "6.5", "6.6", "6.10"] },
    { "id": 6, "tasks": ["6.3", "6.8"] },
    { "id": 7, "tasks": ["6.4", "6.7", "6.9"] },
    { "id": 8, "tasks": ["8.1", "8.2"] },
    { "id": 9, "tasks": ["8.3", "9.1"] },
    { "id": 10, "tasks": ["9.2", "9.3", "9.4", "9.5", "9.6", "9.7", "9.8", "9.9"] },
    { "id": 11, "tasks": ["9.10", "11.1"] },
    { "id": 12, "tasks": ["11.2", "11.3", "11.4", "11.5", "11.6", "11.7", "11.8", "11.9"] },
    { "id": 13, "tasks": ["11.10", "13.1", "13.3"] },
    { "id": 14, "tasks": ["13.2", "14.1"] },
    { "id": 15, "tasks": ["14.2"] }
  ]
}
```
