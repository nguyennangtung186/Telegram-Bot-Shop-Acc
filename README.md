# Telegram Shop Bot

Bot Telegram bán tài khoản số (digital accounts) chạy trên Cloudflare Workers, nạp tiền tự động qua SePay + VietQR, giao hàng tức thì, kèm **Telegram Mini App** cho người mua và **CMS Vue 3** cho quản trị.

Toàn bộ hệ thống (bot + API + CMS + database + cron) gói gọn trong **một Cloudflare Worker duy nhất**, chạy được trên free tier.

---

## Mục lục

- [Tính năng](#tính-năng)
- [Kiến trúc](#kiến-trúc)
- [Tech Stack](#tech-stack)
- [Yêu cầu](#yêu-cầu)
- [1. Cài đặt](#1-cài-đặt)
- [2. Tạo Telegram Bot](#2-tạo-telegram-bot)
- [3. Tạo D1 Database](#3-tạo-d1-database)
- [4. Cấu hình Environment](#4-cấu-hình-environment)
- [5. Chạy Migration](#5-chạy-migration)
- [6. Tạo Admin CMS](#6-tạo-admin-cms)
- [7. Development (Local)](#7-development-local)
- [8. Build & Deploy](#8-build--deploy)
- [9. Cấu hình Webhook](#9-cấu-hình-webhook)
- [10. Chạy Tests](#10-chạy-tests)
- [Chống spam (Rate Limit)](#chống-spam-rate-limit)
- [Template tin nhắn mua thành công](#template-tin-nhắn-mua-thành-công)
- [Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [API Endpoints](#api-endpoints)
- [Database Schema](#database-schema)
- [Environment Variables](#environment-variables)
- [Bot Commands](#bot-commands)
- [Troubleshooting](#troubleshooting)
- [Lưu ý vận hành](#lưu-ý-vận-hành)

---

## Tính năng

### Bot (người mua)
- **Đăng ký tự động** khi gõ `/start`, hiển thị số dư + menu (reply keyboard cố định + inline shortcut).
- **Mua tài khoản**: duyệt danh mục (phân trang), chọn số lượng (grid nhanh hoặc nhập tay), xác nhận, nhận nội dung tài khoản tức thì.
- **Nạp tiền tự động**: chọn mệnh giá hoặc nhập số tiền → sinh mã chuyển khoản + ảnh **VietQR** → SePay webhook tự cộng số dư trong 1–3 phút.
- **Lịch sử đơn hàng** và **xem số dư / thông tin tài khoản**.
- **Template tin nhắn mua thành công** tuỳ biến theo từng loại sản phẩm (hướng dẫn sử dụng, thông tin liên hệ…).

### Telegram Mini App (người mua)
- **SPA Vue 3 riêng** (`miniapp/`) chạy trong Telegram WebView, giao diện mobile-first chuẩn iOS HIG, đồng bộ theme + safe-area của Telegram.
- Mở qua **menu button / direct link** cấu hình ở @BotFather, trỏ tới `https://<WORKER_URL>/app` (không có nút trong code bot).
- **Stateless hoàn toàn**: xác thực bằng `initData` của Telegram trên **mỗi request** (HMAC-SHA256 + TTL 1 giờ), không phát hành JWT/session riêng, không lưu token ở client.
- Tính năng: trang chủ + số dư, duyệt danh mục, chi tiết sản phẩm, mua hàng, nạp tiền (VietQR + poll trạng thái), lịch sử đơn + chi tiết đơn.
- Dùng **chung service nghiệp vụ** với bot (`transaction.ts`, `deposit-policy.ts`) nên luật mua/nạp/rate-limit đồng nhất hai kênh.

### Thanh toán
- Tích hợp **SePay webhook** (xác thực API Key) + **idempotency** theo `sepay_transaction_id` (replay không cộng tiền 2 lần).
- Sinh **VietQR** động theo số tiền + nội dung chuyển khoản.
- **Duyệt nạp thủ công** từ CMS khi webhook bị miss.
- **Cron job** tự hết hạn deposit pending quá 15 phút (chạy mỗi 15 phút).

### CMS (admin)
- Dashboard tổng quan (doanh thu, top sản phẩm, top user).
- Quản lý: Users (+ điều chỉnh số dư), Danh mục, Sản phẩm (import hàng loạt), Đơn hàng, Giao dịch (+ export CSV), Nạp tiền (+ duyệt tay), Cấu hình hệ thống.
- **Editor tin nhắn Telegram** chuyên dụng: toolbar định dạng (bold/italic/code/spoiler/link), chèn biến `[content]`…, live preview bong bóng chat.
- Auth JWT 24h, bcrypt password, khoá tài khoản sau 5 lần đăng nhập sai.
- **Audit log** mọi thao tác admin.

### An toàn dữ liệu
- **Giao dịch atomic** bằng D1 `batch()` — mua hàng / nạp tiền không bao giờ ghi nửa chừng.
- **Concurrency guard** chống mua trùng / âm số dư khi spam nhiều thiết bị cùng lúc.
- **Số dư không bao giờ âm** (CHECK constraint trong DB + application logic).
- **Chống spam (rate limit)**: chặn người dùng bấm nút / gõ lệnh dồn dập, bảo vệ riêng 2 thao tác nặng là tạo mã nạp tiền và xác nhận mua. Chi tiết ở mục [Chống spam](#chống-spam-rate-limit).

---

## Kiến trúc

```
                    ┌──────────────────────────────────────────────┐
   Telegram  ─────► │  POST /webhook/telegram   (secret token)      │
                    │                                               │
   SePay     ─────► │  POST /webhook/sepay      (API key)           │
                    │                                               │
   Mini App  ─────► │  /api/app/*               (Telegram initData) │
   (Vue SPA) ─────► │  GET  /app/*              (static Vue assets) │
                    │                                               │
   Admin     ─────► │  /api/admin/*             (JWT)               │
   (CMS SPA) ─────► │  GET  /cms/*              (static Vue assets) │
                    │                                               │
   Cron      ─────► │  scheduled() mỗi 15 phút  (expire deposits)   │
                    └───────────────────┬──────────────────────────┘
                                        │
                                  Cloudflare D1 (SQLite)
```

Một Worker phục vụ tất cả: webhook bot, webhook thanh toán, REST API + static SPA cho **cả Mini App lẫn CMS**, và scheduled handler.

---

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono
- **Database**: Cloudflare D1 (SQLite)
- **CMS**: Vue 3 + Vite + Tailwind CSS + Vue Router + Chart.js
- **Mini App**: Vue 3 + Vite + Tailwind CSS + Vue Router (Telegram WebApp SDK, mobile-first iOS HIG)
- **Auth**: JWT (jose) + bcryptjs cho CMS; Telegram `initData` HMAC-SHA256 (Web Crypto) cho Mini App
- **Payment**: SePay webhook + VietQR
- **Testing**: Vitest + fast-check (property-based) + E2E bash script

---

## Yêu cầu

- Node.js >= 18
- npm >= 9
- Cloudflare account (free tier đủ dùng)
- Telegram Bot Token (từ @BotFather)
- Tài khoản SePay (my.sepay.vn)

---

## 1. Cài đặt

```bash
# Clone repo
git clone <repo-url>
cd telegram-bot-shop-acc-cloudflare-d1

# Cài dependencies backend
npm install

# Cài dependencies CMS
cd cms && npm install && cd ..

# Cài dependencies Mini App
cd miniapp && npm install && cd ..
```

> Mẹo: `npm run build:miniapp` tự chạy `npm --prefix miniapp install` trước khi build nên có thể bỏ qua bước cài thủ công cho Mini App.

---

## 2. Tạo Telegram Bot

1. Mở Telegram, chat với [@BotFather](https://t.me/BotFather)
2. Gửi `/newbot` → đặt tên → nhận **BOT_TOKEN**
3. Gửi `/setcommands` → chọn bot → nhập:
   ```
   start - Trang chủ
   admin - Quản trị (chỉ admin)
   huy - Huỷ thao tác hiện tại
   ```

---

## 3. Tạo D1 Database

```bash
# Tạo database trên Cloudflare
npx wrangler d1 create telegram-shop-bot-db
```

Copy `database_id` từ output và thay vào `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "telegram-shop-bot-db"
database_id = "YOUR_ACTUAL_DATABASE_ID"  # ← thay ở đây
```

---

## 4. Cấu hình Environment

### 4.1. Local development (`.dev.vars`)

```bash
# Copy file mẫu
cp .dev.vars.example .dev.vars
# Mở .dev.vars và điền giá trị thật cho từng biến
```

Nội dung `.dev.vars`:

```
BOT_TOKEN=your_telegram_bot_token
TELEGRAM_SECRET_TOKEN=your_telegram_secret_token
SEPAY_API_KEY=your_sepay_api_key
ADMIN_IDS=123456789,987654321
JWT_SECRET=your_jwt_secret_at_least_32_chars
BANK_NAME=Vietcombank
BANK_ACCOUNT=1017588888
BANK_OWNER=NGUYEN VAN A
```

> `.dev.vars` đã được `.gitignore` — không commit token thật lên repo.

### 4.2. Production (`wrangler secret`)

```bash
npx wrangler secret put BOT_TOKEN              # Telegram Bot Token
npx wrangler secret put TELEGRAM_SECRET_TOKEN  # Chuỗi ngẫu nhiên verify webhook Telegram
npx wrangler secret put SEPAY_API_KEY          # API Key từ my.sepay.vn → Webhook
npx wrangler secret put ADMIN_IDS              # Telegram IDs admin (cách nhau dấu phẩy)
npx wrangler secret put JWT_SECRET             # Chuỗi ngẫu nhiên ≥ 32 ký tự cho CMS
npx wrangler secret put BANK_NAME              # Tên ngân hàng nhận tiền
npx wrangler secret put BANK_ACCOUNT           # Số tài khoản
npx wrangler secret put BANK_OWNER             # Tên chủ tài khoản
```

---

## 5. Chạy Migration

Migration nằm trong `migrations/`, chạy theo thứ tự:

| File | Mô tả |
|------|--------|
| `0001_initial_schema.sql` | Toàn bộ bảng + index + dữ liệu config mặc định |
| `0002_add_success_template.sql` | Thêm cột `success_template` cho `product_types` |
| `0003_remove_broadcast_config.sql` | Gỡ config `broadcast_enabled` (bỏ tính năng broadcast) |

```bash
# Local (cho development)
npm run db:migrate:local

# Remote (production)
npm run db:migrate:remote
```

> Khi nâng cấp DB đã có sẵn, chỉ cần chạy lại lệnh trên — Wrangler tự áp các migration chưa chạy.

---

## 6. Tạo Admin CMS

Sau khi migrate, tạo admin user cho CMS.

**Bước 1** — Tạo file `test/hash_password.js` để sinh hash bcrypt (dự án dùng ESM):

```js
// test/hash_password.js
import bcrypt from 'bcryptjs'

const password = process.argv[2]
if (!password) {
  console.error('Usage: node test/hash_password.js <password>')
  process.exit(1)
}

const hash = await bcrypt.hash(password, 10)
console.log(hash)
```

**Bước 2** — Sinh hash:

```bash
node test/hash_password.js YOUR_PASSWORD
```

**Bước 3** — Insert admin vào D1:

```bash
# Local
npx wrangler d1 execute telegram-shop-bot-db --local \
  --command="INSERT INTO admin_users (username, password_hash, display_name) VALUES ('admin', 'PASTE_HASH_HERE', 'Admin')"

# Remote
npx wrangler d1 execute telegram-shop-bot-db --remote \
  --command="INSERT INTO admin_users (username, password_hash, display_name) VALUES ('admin', 'PASTE_HASH_HERE', 'Admin')"
```

---

## 7. Development (Local)

```bash
# Chạy Worker locally (port 8787)
npm run dev

# Trong terminal khác, chạy CMS dev server (port 5173, proxy API sang 8787)
cd cms && npm run dev

# Hoặc chạy Mini App dev server (proxy /api/app sang 8787)
cd miniapp && npm run dev
```

Truy cập:
- Worker: http://localhost:8787
- CMS dev: http://localhost:5173/cms/
- CMS từ Worker (sau khi build): http://localhost:8787/cms/
- Mini App từ Worker (sau khi build): http://localhost:8787/app/
- Health check: http://localhost:8787/health

> Mini App cần chạy trong Telegram để có `initData` thật; mở trực tiếp trên trình duyệt sẽ hiện màn "Mở lại từ Telegram" (API trả 401 vì thiếu initData hợp lệ).

---

## 8. Build & Deploy

```bash
# Build riêng nếu cần
npm run build:cms       # CMS    → dist/cms/
npm run build:miniapp   # Mini App → dist/miniapp/
npm run build:all       # Build cả hai

# Deploy: tự build cả CMS + Mini App (hook predeploy) rồi đẩy Worker lên Cloudflare
npm run deploy
```

> `npm run deploy` có hook `predeploy = build:all` nên **tự build cả CMS lẫn Mini App** trước khi `wrangler deploy` — không cần build thủ công trước.
> `wrangler.toml` dùng `[site] bucket = "./dist"`, KV key theo thư mục con: `cms/...` phục vụ tại `/cms/*`, `miniapp/...` phục vụ tại `/app/*`.
> Lưu ý: nếu gọi thẳng `npx wrangler deploy` (bỏ qua npm) thì KHÔNG có predeploy → phải tự `npm run build:all` trước.

---

## 9. Cấu hình Webhook

### Telegram Webhook

```bash
# Thay YOUR_BOT_TOKEN, YOUR_WORKER_URL, YOUR_TELEGRAM_SECRET_TOKEN
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://YOUR_WORKER_URL/webhook/telegram",
    "secret_token": "YOUR_TELEGRAM_SECRET_TOKEN"
  }'
```

### SePay Webhook

1. Đăng nhập https://my.sepay.vn
2. Vào **Webhook** → **Tạo webhook mới**
3. URL: `https://YOUR_WORKER_URL/webhook/sepay`
4. Sự kiện: **Có tiền vào**
5. Bảo mật: **API Key** → paste key đã lưu trong `SEPAY_API_KEY`
   (Worker yêu cầu header `Authorization: Apikey <key>`)

---

## 10. Chạy Tests

### Unit / property-based (Vitest + fast-check)

```bash
npm test            # Chạy tất cả tests
npm run test:watch  # Watch mode
```

### E2E full flow (dữ liệu thật qua HTTP)

`test/e2e_full_flow.sh` chạy 17 test case end-to-end qua HTTP thật (webhook Telegram/SePay + admin API + D1 local): nạp tiền, mua hàng, mua khi hết tiền, **race condition spam mua nhiều thiết bị**, idempotency webhook, duyệt tay, auth, bảo toàn sổ cái. Kết quả xuất ra `docs/E2E_REPORT.md`.

```bash
# Terminal 1: chạy Worker local
npm run dev

# Terminal 2: chạy E2E (in tiến trình realtime từng test case)
bash test/e2e_full_flow.sh
```

---

## Chống spam (Rate Limit)

Bot giới hạn tần suất thao tác của mỗi người dùng để tránh việc bấm nút hoặc gõ lệnh dồn dập làm nghẽn hệ thống, tạo hàng loạt mã QR rác, hay cố tình gọi giao dịch nhiều lần. Cơ chế này hoạt động **hoàn toàn tự động** — admin không cần cấu hình gì.

### Hoạt động như thế nào

Mỗi người dùng có một "hạn mức thao tác" được cấp lại dần theo thời gian (mô hình *token bucket*). Hình dung như một xô đựng token:

- Mỗi thao tác (bấm nút, gõ tin nhắn) tiêu tốn **1 token**.
- Token được **đổ lại đều đặn** theo thời gian, đến mức tối đa cho phép.
- Khi xô cạn token → thao tác bị **tạm chặn**, bot báo "thao tác quá nhanh, vui lòng chờ N giây".

Cách này vẫn cho phép người dùng bình thường thao tác mượt (kể cả khi bấm qua lại giữa các menu sinh nhiều lượt liên tiếp), nhưng chặn được hành vi spam liên tục.

### Ba tầng bảo vệ

| Tầng | Áp dụng cho | Cho phép dồn dập tối đa | Tốc độ bền vững | Mục đích |
|------|-------------|------------------------|-----------------|----------|
| **Chống flood chung** | Mọi nút bấm & tin nhắn | 12 thao tác | ~2 thao tác/giây | Chặn bấm nút / gõ liên tục nói chung |
| **Xác nhận mua** | Nút "✅ Xác nhận mua" | 5 lần | 1 lần mỗi 5 giây | Chống bấm mua nhiều lần (giao dịch tiền) |

Thao tác "Xác nhận mua" được siết chặt hơn flood chung vì nó nặng nhất: chạy giao dịch tiền + gửi nhiều tin nhắn.

### Luật nạp tiền (deposit policy)

Riêng việc **tạo yêu cầu nạp** không dùng token bucket in-memory mà áp **luật nghiệp vụ dựa trên D1** (đúng kể cả khi Worker recycle / chạy song song). Áp dụng **đồng nhất cho cả bot lẫn Mini App**, khai báo tập trung tại `src/services/deposit-policy.ts`:

| Luật | Giá trị | Ý nghĩa |
|------|---------|---------|
| **Cooldown** | 5 phút | Tối thiểu 5 phút giữa 2 lần tạo yêu cầu nạp của cùng một user |
| **Trần pending** | 3 yêu cầu | Tối đa 3 yêu cầu nạp `pending` còn hiệu lực cùng lúc; đủ 3 thì phải chờ cái cũ nhất hết hạn |
| **Hết hạn (TTL)** | 15 phút | Yêu cầu nạp `pending` quá 15 phút coi như hết hạn: không chiếm slot và **không còn được cộng tiền** nếu chuyển khoản tới muộn |

Hệ quả: chuyển khoản đúng nội dung nhưng tới **sau 15 phút** (kể từ lúc tạo yêu cầu) sẽ **không được tính** — webhook SePay bỏ qua, cron dọn trạng thái sang `expired`. Số tiền nạp vẫn được tự cộng nếu khách chuyển trong vòng 15 phút.

### Trải nghiệm người dùng

- Khi bị chặn, bot chỉ nhắc nhở **một lần mỗi 5 giây** — không spam ngược lại người dùng dù họ tiếp tục bấm.
- Thông báo luôn kèm số giây cần chờ, ví dụ: `⏳ Bạn thao tác quá nhanh, chờ 3s.`
- Với nút inline, biểu tượng "đang tải" trên nút luôn được tắt ngay để giao diện không bị treo.
- Người dùng thao tác ở nhịp bình thường gần như **không bao giờ** chạm giới hạn.

### Lưu ý kỹ thuật

- Bộ đếm lưu **trong bộ nhớ Worker** (giống cơ chế session), không ghi vào database nên không làm tăng tải D1.
- Khi Worker khởi động lại (cold start) bộ đếm sẽ reset. Spam từ một người là chuỗi request liên tiếp nên gần như luôn rơi vào cùng một tiến trình → cơ chế vẫn hiệu quả trong thực tế.
- Đây là lớp bảo vệ **bổ sung** cho các lớp đã có (giao dịch atomic, concurrency guard, CHECK số dư), không thay thế chúng. Kể cả khi vài request spam lọt qua, tiền và tồn kho vẫn an toàn tuyệt đối.
- Các ngưỡng flood/mua khai báo tập trung trong `src/bot/rate-limit.ts` (`FLOOD_RULE`, `PURCHASE_RULE`); luật nạp tiền (cooldown / trần pending / TTL) trong `src/services/deposit-policy.ts` — chỉnh ở đây nếu muốn nới/siết.

---

## Template tin nhắn mua thành công

Mỗi loại sản phẩm (`product_types`) có cột `success_template` cho phép tuỳ biến **phần thân** của tin nhắn giao hàng. Phần **header** (`✅ Mua hàng thành công` + tên × số lượng + `📋 Nội dung sản phẩm:`) luôn tự động hiển thị.

Soạn template trong CMS → **Danh mục** → Sửa → ô "Tin nhắn khi mua thành công" (có editor + live preview). Để trống = dùng mẫu mặc định.

**Placeholder hỗ trợ:**

| Placeholder | Thay bằng |
|-------------|-----------|
| `[content]` | Danh sách tài khoản đã mua (đánh số, mỗi dòng bọc `<code>`) |
| `[name]` | Tên loại sản phẩm |
| `[emoji]` | Emoji loại sản phẩm |
| `[quantity]` | Số lượng mua |
| `[total]` | Tổng tiền (đã format, vd `75,000đ`) |
| `[balance]` | Số dư còn lại (đã format) |

**Định dạng Telegram HTML hỗ trợ:** `<b> <i> <u> <s> <code> <pre> <a> <tg-spoiler> <blockquote>`. Giá trị động được tự escape để không phá vỡ HTML.

**Ví dụ template:**

```html
[content]

<b>Hướng dẫn sử dụng:</b> đăng nhập tại example.com
Mọi thắc mắc liên hệ @vippro

💵 [total] | 💰 Còn: [balance]
```

---

## Cấu trúc thư mục

```
├── src/
│   ├── index.ts              # Entry point (Hono app + scheduled handler)
│   ├── types/                # TypeScript type definitions
│   │   ├── api.ts            # API response types
│   │   ├── bindings.ts       # Cloudflare Workers bindings
│   │   ├── db.ts             # D1 row types
│   │   ├── sepay.ts          # SePay webhook payload
│   │   ├── telegram.ts       # Telegram update types
│   │   ├── miniapp.ts        # Mini App DTO types (/api/app/*)
│   │   └── index.ts
│   ├── bot/
│   │   ├── commands/         # start.ts, admin.ts
│   │   ├── callbacks/        # purchase, deposit, history, account
│   │   ├── utils/            # Pagination
│   │   ├── telegram-api.ts   # Telegram API helpers + keyboard builders
│   │   ├── session.ts        # In-memory session manager (multi-step flows)
│   │   ├── rate-limit.ts     # Chống spam (token bucket in-memory)
│   │   └── router.ts         # Callback & text dispatcher
│   ├── routes/
│   │   ├── telegram.ts       # POST /webhook/telegram
│   │   ├── sepay.ts          # POST /webhook/sepay
│   │   ├── static.ts         # GET /cms/* (CMS Vue SPA assets)
│   │   ├── miniapp-static.ts # GET /app/* (Mini App Vue SPA assets, history fallback)
│   │   ├── miniapp-api.ts     # GET/POST /api/app/* (Mini App business API)
│   │   └── admin/            # CMS REST API (/api/admin/*)
│   │       ├── index.ts      # Mount sub-routers
│   │       ├── auth.ts       # login / refresh / me
│   │       ├── users.ts      # users + adjust-balance
│   │       ├── product-types.ts # CRUD danh mục + success_template
│   │       ├── products.ts   # list + import + delete
│   │       ├── orders.ts     # list + detail
│   │       ├── transactions.ts # list + export CSV
│   │       ├── deposits.ts   # list + manual approve
│   │       ├── stats.ts      # dashboard / revenue / top-*
│   │       └── config.ts     # system config
│   ├── services/
│   │   ├── transaction.ts    # Atomic purchase/deposit (D1 batch)
│   │   ├── deposit-policy.ts # Luật nạp dùng chung: cooldown + trần pending + TTL
│   │   └── deposit-expiry.ts # Cron: expire pending deposits
│   ├── middleware/
│   │   ├── jwt-auth.ts       # JWT verify cho CMS
│   │   ├── telegram-auth.ts  # Verify Telegram secret token (webhook)
│   │   ├── sepay-auth.ts     # Verify SePay API Key
│   │   ├── miniapp-auth.ts   # Verify Telegram initData (HMAC + TTL) cho Mini App
│   │   └── audit.ts          # Audit log thao tác admin
│   └── utils/
│       ├── admin.ts          # Admin user helpers
│       ├── auth.ts           # JWT sign/verify + password hash
│       ├── error-handler.ts  # Centralized error response
│       ├── format.ts         # Currency, date, mask username
│       ├── retry.ts          # Exponential backoff
│       ├── transfer-code.ts  # Generate / parse mã chuyển khoản
│       ├── vietqr.ts         # Build VietQR URL
│       ├── telegram-initdata.ts # Verify + parse Telegram Mini App initData
│       ├── telegram-template.ts # Render template tin nhắn mua thành công
│       └── index.ts
├── cms/                      # Vue 3 CMS SPA (admin) → dist/cms/
│   └── src/
│       ├── views/            # Login, Dashboard, Users, Categories,
│       │                     #   Products, Orders, Transactions, Deposits, Config
│       ├── components/       # Sidebar, Header, Icon, TelegramEditor
│       ├── api/              # Fetch client + JWT management
│       └── router/           # Vue Router
├── miniapp/                  # Vue 3 Mini App SPA (người mua) → dist/miniapp/
│   └── src/
│       ├── views/            # Home, Shop, ProductDetail, Deposit, History, OrderDetail, Account
│       ├── components/       # GlassCard, QrPanel, QtyStepper, Toast, LoadingOverlay…
│       ├── telegram/         # sdk.ts (WebApp wrapper) + theme.ts (safe-area, theme)
│       ├── api/              # client.ts (stateless, gắn initData mỗi request)
│       ├── stores/           # ui / user store
│       └── router/           # Vue Router (history mode)
├── migrations/               # D1 SQL migrations (0001, 0002)
├── test/                     # Vitest + fast-check + e2e_full_flow.sh
├── docs/                     # E2E_REPORT.md (kết quả test E2E)
├── wrangler.toml             # Cloudflare Worker config
├── .dev.vars.example         # Mẫu env cho local dev
└── package.json
```

---

## API Endpoints

### Public webhooks

| Method | Path | Auth | Mô tả |
|--------|------|------|--------|
| POST | `/webhook/telegram` | Secret Token | Telegram webhook |
| POST | `/webhook/sepay` | API Key | SePay payment webhook |
| GET | `/health` | None | Health check |
| GET | `/cms/*` | None | CMS static assets (Vue SPA) |
| GET | `/app/*` | None | Mini App static assets (Vue SPA, history fallback) |

### Mini App API (đều yêu cầu header `X-Telegram-Init-Data`)

Xác thực stateless bằng `initData` của Telegram (HMAC-SHA256 + TTL 1 giờ) trên mỗi request; thiếu/sai/hết hạn → 401. Người mua được upsert tự động theo `telegram_id`.

| Method | Path | Mô tả |
|--------|------|--------|
| GET | `/api/app/me` | Thông tin người mua hiện tại (định danh, số dư) |
| GET | `/api/app/home` | Dữ liệu trang chủ (số dư + lối tắt nhanh) |
| GET | `/api/app/product-types` | Danh sách danh mục (kèm tồn kho / `in_stock`) |
| GET | `/api/app/product-types/:id` | Chi tiết danh mục |
| POST | `/api/app/purchase` | Mua hàng (reuse `transactionService.executePurchase`) |
| POST | `/api/app/deposits` | Tạo yêu cầu nạp + VietQR (áp `checkDepositPolicy`) |
| GET | `/api/app/deposits/:id` | Poll trạng thái yêu cầu nạp (read-only) |
| GET | `/api/app/orders` | Lịch sử đơn của người mua (paginate) |
| GET | `/api/app/orders/:id` | Chi tiết đơn (kèm nội dung sản phẩm đã mua) |

### CMS Auth

| Method | Path | Auth | Mô tả |
|--------|------|------|--------|
| POST | `/api/admin/auth/login` | None | Đăng nhập, trả JWT |
| POST | `/api/admin/auth/refresh` | JWT | Làm mới JWT |
| GET | `/api/admin/auth/me` | JWT | Thông tin admin hiện tại |

### CMS Resources (đều yêu cầu JWT)

| Method | Path | Mô tả |
|--------|------|--------|
| GET | `/api/admin/users` | Danh sách users (search, filter, paginate) |
| GET | `/api/admin/users/:id` | Chi tiết user |
| POST | `/api/admin/users/:id/adjust-balance` | Điều chỉnh số dư thủ công |
| GET | `/api/admin/product-types` | Danh sách loại sản phẩm (kèm tồn kho) |
| POST | `/api/admin/product-types` | Tạo loại sản phẩm (+ success_template) |
| PUT | `/api/admin/product-types/:id` | Sửa loại sản phẩm |
| DELETE | `/api/admin/product-types/:id` | Xoá loại sản phẩm |
| GET | `/api/admin/products` | Danh sách products |
| POST | `/api/admin/products/import` | Import products hàng loạt |
| DELETE | `/api/admin/products/:id` | Xoá product |
| GET | `/api/admin/orders` | Danh sách đơn hàng |
| GET | `/api/admin/orders/:id` | Chi tiết đơn hàng |
| GET | `/api/admin/transactions` | Sổ cái giao dịch |
| GET | `/api/admin/transactions/export` | Export CSV |
| GET | `/api/admin/deposits` | Danh sách nạp tiền |
| POST | `/api/admin/deposits/:id/approve` | Duyệt nạp tiền thủ công |
| GET | `/api/admin/stats/dashboard` | Tổng quan dashboard |
| GET | `/api/admin/stats/revenue` | Doanh thu theo khoảng thời gian |
| GET | `/api/admin/stats/top-products` | Top sản phẩm bán chạy |
| GET | `/api/admin/stats/top-users` | Top users chi tiêu |
| GET | `/api/admin/config` | System config |
| PUT | `/api/admin/config` | Update system config |

---

## Database Schema

| Bảng | Mô tả |
|------|--------|
| `users` | Người dùng Telegram + số dư (CHECK balance >= 0) |
| `product_types` | Danh mục sản phẩm (giá, emoji, hiển thị, `success_template`) |
| `products` | Tài khoản số cụ thể (available / sold / reserved) |
| `orders` | Đơn hàng |
| `order_items` | Chi tiết đơn ↔ product |
| `transactions` | Sổ cái tài chính (deposit / purchase / refund / adjustment) |
| `deposits` | Yêu cầu nạp qua SePay (transfer_code, status, sepay_transaction_id) |
| `admin_users` | Tài khoản admin CMS (bcrypt hash, lockout) |
| `system_config` | Cấu hình key-value (shop_name, min/max_deposit…) |
| `audit_logs` | Nhật ký thao tác admin |

Config mặc định (`0001_initial_schema.sql`): `shop_name`, `min_deposit` (20.000đ), `max_deposit` (100.000.000đ), `maintenance_mode`.

---

## Environment Variables

| Tên | Loại | Mô tả |
|-----|------|--------|
| `DB` | D1 Binding | Cloudflare D1 database |
| `BOT_TOKEN` | Secret | Telegram Bot API token |
| `TELEGRAM_SECRET_TOKEN` | Secret | Webhook verification secret |
| `SEPAY_API_KEY` | Secret | SePay webhook API key |
| `ADMIN_IDS` | Secret | Telegram IDs admin (comma-separated) |
| `JWT_SECRET` | Secret | JWT signing key cho CMS (≥ 32 chars) |
| `BANK_NAME` | Secret | Tên ngân hàng nhận tiền |
| `BANK_ACCOUNT` | Secret | Số tài khoản ngân hàng |
| `BANK_OWNER` | Secret | Chủ tài khoản |

---

## Bot Commands

| Lệnh | Mô tả |
|-------|--------|
| `/start` | Đăng ký + hiển thị menu chính |
| `/admin` | Bảng điều khiển admin (chỉ admin) |
| `/huy` | Huỷ thao tác đang chờ |
| `/cancel` | Alias của `/huy` |

---

## Troubleshooting

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|-------------|------------------------|------------|
| Webhook Telegram trả 401 | Sai/thiếu `TELEGRAM_SECRET_TOKEN` | Set lại secret + setWebhook với đúng `secret_token` |
| Webhook SePay trả 401 | Sai `SEPAY_API_KEY` hoặc header không phải `Apikey <key>` | Kiểm tra API Key trong my.sepay.vn khớp secret |
| Nạp tiền không cộng số dư | Sai nội dung chuyển khoản (mã `NAP…`) hoặc số tiền ngoài 20k–100tr | Duyệt tay trong CMS → Nạp tiền, hoặc dặn khách CK đúng nội dung |
| CMS đăng nhập 401 liên tục | `JWT_SECRET` local ≠ remote, hoặc token hết hạn (24h) | Đăng nhập lại; đảm bảo `JWT_SECRET` đã set |
| Bot không phản hồi | Webhook chưa set hoặc URL sai | Gọi lại `setWebhook`, kiểm tra `/health` |
| `Couldn't find a D1 DB` | Chưa thay `database_id` trong `wrangler.toml` | Dán đúng `database_id` từ `wrangler d1 create` |
| Deploy xong CMS/Mini App vẫn cũ | Gọi thẳng `npx wrangler deploy` (bỏ qua predeploy) | Dùng `npm run deploy` (tự `build:all`), hoặc tự `npm run build:all` trước |
| Mini App phải reload mới dùng được | Webview cache bản JS cũ sau khi deploy | Đóng hẳn Mini App rồi mở lại; bản mới đọc `initData` tươi mỗi request nên không cần reload nữa |
| Mini App hiện "Mở lại từ Telegram" | Mở ngoài Telegram hoặc `initData` hết hạn (TTL 1h) | Mở lại Mini App từ trong Telegram |

---

## Lưu ý vận hành

- **D1 Database ID**: Nhớ thay `database_id` trong `wrangler.toml` bằng ID thật sau khi tạo database.
- **Build trước deploy**: `npm run deploy` tự build cả CMS + Mini App (hook `predeploy = build:all`). Chỉ khi gọi thẳng `npx wrangler deploy` mới cần tự `npm run build:all` trước.
- **Mini App auth**: stateless, verify `initData` (HMAC-SHA256 + TTL 1 giờ) trên mỗi request `/api/app/*`; không phát hành JWT/session riêng, không lưu token ở client.
- **Deposit expiry**: Cron job chạy mỗi 15 phút, expire deposits pending > 15 phút. Luật nạp (cooldown 5 phút, tối đa 3 pending, TTL 15 phút) ở `src/services/deposit-policy.ts`.
- **Session timeout**: Flow nhập liệu (nạp tiền, admin) lưu in-memory theo isolate; reset khi Worker cold start.
- **Chống spam (rate limit)**: Giới hạn tần suất thao tác mỗi user bằng token bucket in-memory (xem mục [Chống spam](#chống-spam-rate-limit)). Ngưỡng khai báo trong `src/bot/rate-limit.ts`; reset khi Worker cold start, không ghi DB.
- **Balance không bao giờ âm**: Enforced bởi CHECK constraint trong D1 + application logic.
- **Atomic transactions**: Mọi thao tác multi-table dùng D1 `batch()` để đảm bảo consistency; mua hàng dùng concurrency guard `WHERE balance >= total` + FK `order_id`.
- **Webhook idempotency**: SePay replay cùng `sepay_transaction_id` không cộng tiền lần 2.
- **Audit log**: Mọi thao tác admin (CMS + bot `/admin`) được log vào bảng `audit_logs`.
- **Bảo mật**: `.dev.vars`, `dist/`, `.wrangler/` đã được `.gitignore` — không commit secret.
