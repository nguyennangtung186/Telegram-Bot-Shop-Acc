---
name: run-deploy-telegram-shop-bot
description: Use khi người dùng muốn chạy local, setup từ đầu, hoặc deploy dự án Telegram Shop Bot (Cloudflare Workers + D1 + Vue CMS). Kích hoạt khi nghe "chạy dự án", "run local", "setup", "deploy", "lên production", "build CMS".
---

# Run & Deploy — Telegram Shop Bot

Skill này hướng dẫn AI chạy/deploy dự án **end-to-end** mà không cần hỏi lại từng bước. Dự án là một Cloudflare Worker duy nhất phục vụ: webhook Telegram, webhook SePay, REST API cho CMS, static assets Vue SPA, và cron expire deposit.

## Bối cảnh cố định (không cần dò lại)

- **Runtime**: Cloudflare Workers + Hono. **DB**: Cloudflare D1 (binding tên `DB`, database `telegram-shop-bot-db`).
- **CMS**: Vue 3 + Vite trong `cms/`, build ra `dist/cms/`, phục vụ tại `/cms/*`.
- **Entry**: `src/index.ts`. **Config**: `wrangler.toml`. **Migrations**: `migrations/` (chạy theo thứ tự).
- **Local env**: `.dev.vars` (đã gitignore). **Mẫu**: `.dev.vars.example`.
- **Scripts** (trong `package.json`):
  - `npm run dev` → `wrangler dev` (Worker local, port mặc định 8787)
  - `npm run build:cms` → build Vue CMS vào `dist/cms`
  - `npm run deploy` → `wrangler deploy`
  - `npm run db:migrate:local` / `npm run db:migrate:remote`
  - `npm test` (vitest) / `npm run test:watch`

## QUY TẮC BẮT BUỘC

1. **Progress realtime**: server/build/test chạy lâu → dùng background process rồi đọc log dần. KHÔNG `cmd | tail` chờ im lặng.
2. **Build CMS trước deploy**: `npm run deploy` KHÔNG tự build CMS. Luôn `npm run build:cms` trước nếu CMS có thay đổi.
3. **Không tự ý đổi secret/`wrangler.toml` `database_id`** nếu đã có giá trị. Chỉ sửa khi user yêu cầu hoặc giá trị còn placeholder.
4. **Migration remote là thao tác production** → chỉ chạy `db:migrate:remote` và `deploy` khi user xác nhận deploy.
5. **Không echo secret** ra response (token, JWT, API key). Tham chiếu theo tên biến.

---

## Workflow A — Chạy Local (dev)

Dùng khi user nói "chạy dự án", "run local", "test thử".

1. **Kiểm tra deps**: nếu `node_modules` thiếu → `npm install` (root) và `npm install --prefix cms`.
2. **Kiểm tra `.dev.vars`**: nếu chưa có → copy từ `.dev.vars.example`, báo user điền `BOT_TOKEN`, `JWT_SECRET`, `SEPAY_API_KEY`, `ADMIN_IDS`, `BANK_*`, `TELEGRAM_SECRET_TOKEN`. KHÔNG bịa giá trị.
3. **Kiểm tra `wrangler.toml`**: `database_id` phải là UUID thật, không phải placeholder. Nếu placeholder → hướng dẫn `npx wrangler d1 create telegram-shop-bot-db` rồi dán ID.
4. **Migrate local**: `npm run db:migrate:local` (áp cả `0001`, `0002`). An toàn để chạy lại.
5. **Start Worker** (background): `npx wrangler dev --port 8787 --local`. Đọc log tới khi thấy `Ready on http://localhost:8787`.
6. **Verify**: `curl -s http://127.0.0.1:8787/health` → `{"status":"ok"}`.
7. (Tuỳ chọn) **CMS dev server** riêng: `npm run dev --prefix cms` (port 5173, proxy API sang 8787). Hoặc dùng CMS đã build tại `http://localhost:8787/cms/`.

Nếu cần admin để login CMS → xem [Tạo admin](#tạo-admin-cms).

---

## Workflow B — Setup từ đầu (máy mới)

Dùng khi user clone repo lần đầu. Chạy tuần tự, dừng lại hỏi khi thiếu thông tin bí mật.

1. `npm install` + `npm install --prefix cms`.
2. **Telegram bot**: hướng dẫn user tạo qua @BotFather lấy `BOT_TOKEN` (không tự làm được, cần user).
3. **D1**: `npx wrangler d1 create telegram-shop-bot-db` → dán `database_id` vào `wrangler.toml`.
4. **Env**: copy `.dev.vars.example` → `.dev.vars`, user điền giá trị thật.
5. **Migrate local**: `npm run db:migrate:local`.
6. **Tạo admin** (xem dưới).
7. Chạy local theo Workflow A từ bước 5.

---

## Workflow C — Deploy Production

Dùng khi user nói "deploy", "lên production". Đây là thao tác production → cần secrets đã set + build CMS.

1. **Kiểm tra secrets remote**: các secret production set qua `npx wrangler secret put <NAME>` (KHÔNG dùng `.dev.vars` cho production). Bộ cần: `BOT_TOKEN`, `TELEGRAM_SECRET_TOKEN`, `SEPAY_API_KEY`, `ADMIN_IDS`, `JWT_SECRET`, `BANK_NAME`, `BANK_ACCOUNT`, `BANK_OWNER`. Nếu nghi chưa set → liệt kê lệnh cho user, không tự đặt giá trị.
2. **Migrate remote** (nếu có migration mới): `npm run db:migrate:remote`.
3. **Build CMS**: `npm run build:cms` (background, đợi `built in`).
4. **Deploy**: `npx wrangler deploy` (background). Đọc log tới khi thấy URL `https://...workers.dev` + `Current Version ID`.
5. **Báo version**: trả về Version ID + URL cho user.
6. **Webhook** (lần đầu hoặc khi đổi domain): set lại Telegram webhook + SePay webhook (xem [Webhook](#cấu-hình-webhook)).

---

## Tạo admin CMS

CMS cần ít nhất 1 record trong `admin_users`. Mật khẩu hash bằng bcrypt (cost 10).

1. Tạo `test/hash_password.js` (ESM):
   ```js
   import bcrypt from 'bcryptjs'
   const pw = process.argv[2]
   if (!pw) { console.error('Usage: node test/hash_password.js <password>'); process.exit(1) }
   console.log(await bcrypt.hash(pw, 10))
   ```
2. `node test/hash_password.js <password>` → copy hash.
3. Insert (local hoặc remote):
   ```bash
   npx wrangler d1 execute telegram-shop-bot-db --local \
     --command="INSERT INTO admin_users (username, password_hash, display_name) VALUES ('admin', 'HASH', 'Admin')"
   ```

---

## Cấu hình Webhook

**Telegram**:
```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<WORKER_URL>/webhook/telegram","secret_token":"<TELEGRAM_SECRET_TOKEN>"}'
```

**SePay**: my.sepay.vn → Webhook → URL `https://<WORKER_URL>/webhook/sepay`, sự kiện "Có tiền vào", bảo mật API Key (Worker yêu cầu header `Authorization: Apikey <key>`).

---

## Test

- **Unit / property-based**: `npm test` (vitest + fast-check).
- **E2E full flow thật**: cần Worker local đang chạy (Workflow A), rồi `bash test/e2e_full_flow.sh`. Chạy 17 case qua HTTP thật (nạp, mua, race condition, idempotency, auth, bảo toàn sổ cái), in tiến trình từng case, xuất `docs/E2E_REPORT.md`.

---

## Verify checklist sau khi chạy/deploy

- [ ] `curl /health` trả `{"status":"ok"}`
- [ ] CMS load tại `/cms/` (local: 8787, hoặc dev 5173)
- [ ] Login CMS được (admin tồn tại, `JWT_SECRET` đã set)
- [ ] Bot phản hồi `/start` (webhook đã set đúng + `TELEGRAM_SECRET_TOKEN` khớp)
- [ ] (deploy) Version ID mới + URL đã in ra

## Lỗi thường gặp

| Lỗi | Xử lý |
|-----|-------|
| `Couldn't find a D1 DB ... 'DB'` | `database_id` trong `wrangler.toml` còn placeholder → tạo DB + dán ID |
| Webhook 401 | Sai `TELEGRAM_SECRET_TOKEN` / `SEPAY_API_KEY` |
| CMS cũ sau deploy | Quên `npm run build:cms` trước `deploy` |
| Login CMS fail | Chưa tạo admin, hoặc `JWT_SECRET` local ≠ remote |
| Nạp không cộng tiền | Sai nội dung CK (mã `NAP…`) / số tiền ngoài 20k–100tr → duyệt tay ở CMS |
