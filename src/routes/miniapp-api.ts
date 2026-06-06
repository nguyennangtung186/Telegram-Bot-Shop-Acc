/**
 * Mini App business API — prefix `/api/app/*`.
 *
 * Lớp HTTP mỏng (controller) cho Telegram Mini App: KHÔNG viết lại logic nghiệp
 * vụ, chỉ điều phối request → service/util hiện hữu rồi map sang `ApiResponse`.
 *
 * Mọi endpoint dưới prefix này đều qua `miniAppAuth` (`miniAppApi.use('/*', ...)`)
 * nên luôn yêu cầu header `X-Telegram-Init-Data` hợp lệ. Người mua được định danh
 * qua `c.get('user')` (đã JOIN/lọc theo `telegram_id`); controller KHÔNG nhận
 * `user_id` từ client (chống IDOR).
 *
 * File này sẽ được MỞ RỘNG ở các task sau (deposits, orders); giữ cấu trúc phẳng
 * theo từng endpoint để dễ bổ sung.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6,
 * 6.7, 7.1, 7.2, 7.3, 7.5, 8.1, 8.2, 8.3, 8.4, 8.5, 10.1, 10.3, 10.4, 11.1, 11.2, 11.3,
 * 11.4, 12.1, 12.2, 12.3, 15.3, 16.2, 16.3
 */

import { Hono } from 'hono'
import type { Bindings } from '../types'
import type { DbProductType, DbDeposit } from '../types/db'
import type { ApiResponse } from '../types/api'
import type {
  MeDto,
  ProductTypeListItemDto,
  ProductTypeDetailDto,
  PurchaseResultDto,
  DepositCreatedDto,
  DepositStatusDto,
  OrderListItemDto,
  OrderDetailDto,
} from '../types/miniapp'
import { miniAppAuth, type MiniAppVariables } from '../middleware/miniapp-auth'
import { formatCurrency } from '../utils/format'
import { transactionService } from '../services/transaction'
import { renderSuccessMessage, escapeHtml } from '../utils/telegram-template'
import { sendMessage, sendPhoto } from '../bot/telegram-api'
import { consumeToken, PURCHASE_RULE } from '../bot/rate-limit'
import { checkDepositPolicy, depositPolicyMessage } from '../services/deposit-policy'
import { resolveBankConfig } from '../services/bank-config'
import { generateTransferCode } from '../utils/transfer-code'
import { generateVietQRUrl } from '../utils/vietqr'

type MiniAppEnv = {
  Bindings: Bindings
  Variables: MiniAppVariables
}

/** Lối tắt nhanh hiển thị ở trang chủ; frontend chịu trách nhiệm điều hướng (Req 4.3, 4.4). */
const HOME_SHORTCUTS = ['shop', 'deposit', 'history', 'account'] as const

/**
 * Trần số lượng cho mỗi lần mua (Req 5.3 — `max_quantity`).
 * Giữ đồng bộ với cap `MAX_QTY = 50` của flow mua hàng trong bot
 * (`src/bot/callbacks/purchase.ts`) để Mini App và bot hành xử nhất quán.
 */
const MAX_PURCHASE_QUANTITY = 50

/**
 * Fallback giới hạn số tiền nạp khi `system_config` thiếu key tương ứng.
 * Giữ đồng bộ với giá trị seed của migration `0001_initial_schema.sql`
 * (`min_deposit = 20000`, `max_deposit = 100000000`) để hành vi nhất quán
 * kể cả khi config bị xoá/migrate lỗi (fail-safe, không chặn nạp hợp lệ).
 */
const DEFAULT_MIN_DEPOSIT = 20_000
const DEFAULT_MAX_DEPOSIT = 100_000_000

/** Dữ liệu trang chủ `GET /api/app/home` (Req 4). */
interface HomeDto {
  balance: number
  balance_display: string
  shortcuts: readonly string[]
}

/** Một dòng kết quả query danh sách loại sản phẩm (Req 5.1, 5.2). */
interface ProductTypeListRow {
  id: number
  name: string
  emoji: string
  price: number
  sort_order: number
  stock: number // COUNT(products.status='available') — LEFT JOIN nên có thể = 0
}

/** Một dòng kết quả query chi tiết loại sản phẩm (Req 5.3). */
interface ProductTypeDetailRow {
  id: number
  name: string
  emoji: string
  description: string | null
  price: number
  stock: number // COUNT(products.status='available') — LEFT JOIN nên có thể = 0
}

const miniAppApi = new Hono<MiniAppEnv>()

// Toàn bộ prefix yêu cầu initData hợp lệ (Req 1) — verify per-request, stateless.
miniAppApi.use('/*', miniAppAuth)

/**
 * GET /me — Thông tin tài khoản + số dư (Req 12).
 *
 * Trả `MeDto` dựng từ `c.get('user')` (bản ghi `users` đã upsert theo `telegram_id`).
 * `balance_display` format qua `formatCurrency` để đồng bộ định dạng tiền tệ (Req 4.2).
 * KHÔNG trả bất kỳ field quản trị nào — chỉ các field định danh người mua (Req 12.3).
 */
miniAppApi.get('/me', (c) => {
  const user = c.get('user')

  const body: ApiResponse<MeDto> = {
    success: true,
    data: {
      telegram_id: user.telegram_id,
      username: user.username,
      first_name: user.first_name,
      balance: user.balance,
      balance_display: formatCurrency(user.balance),
    },
    error: null,
  }

  return c.json(body)
})

/**
 * GET /home — Trang chủ (Req 4).
 *
 * Trả số dư hiện tại của người mua (lấy từ `users` theo `telegram_id`, Req 4.1),
 * `balance_display` đã format (Req 4.2) và danh sách lối tắt nhanh (Req 4.3).
 */
miniAppApi.get('/home', (c) => {
  const user = c.get('user')

  const body: ApiResponse<HomeDto> = {
    success: true,
    data: {
      balance: user.balance,
      balance_display: formatCurrency(user.balance),
      shortcuts: HOME_SHORTCUTS,
    },
    error: null,
  }

  return c.json(body)
})

/**
 * GET /product-types — Danh mục loại sản phẩm + tồn kho (Req 5.1, 5.2, 5.4).
 *
 * Trả các `product_types` đang hiển thị (`is_visible = 1`), kèm tồn kho `available`
 * đếm qua `LEFT JOIN products`, sắp xếp `sort_order ASC, name ASC`. KHÁC query của bot
 * (vốn `INNER JOIN ... HAVING stock > 0`): ở đây dùng `LEFT JOIN` + `COUNT(CASE ...)`
 * và KHÔNG lọc theo tồn kho nên BAO GỒM cả loại hết hàng (`stock = 0`), để frontend
 * hiển thị trạng thái hết hàng và vô hiệu hóa mua (Req 5.4). `in_stock = stock > 0`.
 */
miniAppApi.get('/product-types', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT pt.id, pt.name, pt.emoji, pt.price, pt.sort_order,
            COUNT(CASE WHEN p.status = 'available' THEN 1 END) AS stock
     FROM product_types pt
     LEFT JOIN products p ON p.type_id = pt.id
     WHERE pt.is_visible = 1
     GROUP BY pt.id
     ORDER BY pt.sort_order ASC, pt.name ASC`
  ).all<ProductTypeListRow>()

  const data: ProductTypeListItemDto[] = results.map((row) => ({
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    price: row.price,
    price_display: formatCurrency(row.price),
    stock: row.stock,
    in_stock: row.stock > 0,
  }))

  const body: ApiResponse<ProductTypeListItemDto[]> = {
    success: true,
    data,
    error: null,
  }

  return c.json(body)
})

/**
 * GET /product-types/:id — Chi tiết loại sản phẩm (Req 5.3, 5.4).
 *
 * Trả mô tả, giá, tồn kho `available` và `max_quantity` (trần mua mỗi lần). `:id` được
 * parse sang integer — không hợp lệ → 404. Query lọc `is_visible = 1` nên loại ẩn hoặc
 * không tồn tại đều trả 404 `not_found`. KHÔNG trả `success_template` (chỉ dùng server-side).
 */
miniAppApi.get('/product-types/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    const notFound: ApiResponse<null> = { success: false, data: null, error: 'not_found' }
    return c.json(notFound, 404)
  }

  const row = await c.env.DB.prepare(
    `SELECT pt.id, pt.name, pt.emoji, pt.description, pt.price,
            COUNT(CASE WHEN p.status = 'available' THEN 1 END) AS stock
     FROM product_types pt
     LEFT JOIN products p ON p.type_id = pt.id
     WHERE pt.id = ? AND pt.is_visible = 1
     GROUP BY pt.id`
  )
    .bind(id)
    .first<ProductTypeDetailRow>()

  if (!row) {
    const notFound: ApiResponse<null> = { success: false, data: null, error: 'not_found' }
    return c.json(notFound, 404)
  }

  const data: ProductTypeDetailDto = {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    description: row.description,
    price: row.price,
    price_display: formatCurrency(row.price),
    stock: row.stock,
    in_stock: row.stock > 0,
    max_quantity: MAX_PURCHASE_QUANTITY,
  }

  const body: ApiResponse<ProductTypeDetailDto> = {
    success: true,
    data,
    error: null,
  }

  return c.json(body)
})

/**
 * POST /purchase — Mua hàng atomic (Req 6, 7, 15.3, 16.2, 16.3).
 *
 * Controller mỏng: KHÔNG viết lại logic atomic — chỉ điều phối validate → rate-limit →
 * load `product_type` → `transactionService.executePurchase` (reuse) → đồng bộ tin nhắn bot
 * sau commit. Tổng tiền tính SERVER-SIDE (`price × quantity`), KHÔNG tin client (Req 6.1, 16.3).
 *
 * Request body: `{ productTypeId: number, quantity: number }` (đọc qua `c.req.json()`).
 *
 * Luồng mã lỗi:
 *  - JSON hỏng / `quantity` không phải integer trong `[1, MAX_PURCHASE_QUANTITY]` → 400 `validation_error` (Req 6.1)
 *  - double-tap vượt `PURCHASE_RULE` (reuse rate-limit của bot) → 429 `rate_limited`
 *  - `product_type` không tồn tại hoặc `is_visible = 0` → 404 `not_found` (Req 5.4)
 *  - lỗi service: `insufficient_balance`/`insufficient_stock` → 409, `db_error` → 500 (Req 6.3, 6.4)
 *
 * Sau commit (Req 7): dựng HTML qua `renderSuccessMessage` rồi `sendMessage` fire-and-forget qua
 * `c.executionCtx.waitUntil(promise.catch(log))` — lỗi gửi tin KHÔNG rollback giao dịch đã commit (Req 7.5).
 * Trả `PurchaseResultDto` gồm `order_id`, `quantity`, `total_amount`, số dư mới + display, `contents` (Req 6.6, 6.7).
 */
miniAppApi.post('/purchase', async (c) => {
  const user = c.get('user')

  // Đọc body — guard JSON hỏng → coi là input không hợp lệ (Req 6.1).
  let payload: { productTypeId?: unknown; quantity?: unknown }
  try {
    payload = await c.req.json()
  } catch {
    const bad: ApiResponse<null> = { success: false, data: null, error: 'validation_error' }
    return c.json(bad, 400)
  }

  const productTypeId = Number(payload.productTypeId)
  const quantity = Number(payload.quantity)

  // Validate quantity: integer trong [1, MAX_PURCHASE_QUANTITY] (Req 6.1).
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PURCHASE_QUANTITY) {
    const bad: ApiResponse<null> = { success: false, data: null, error: 'validation_error' }
    return c.json(bad, 400)
  }

  // productTypeId không hợp lệ → 404 (đồng bộ ngữ nghĩa với GET /product-types/:id).
  if (!Number.isInteger(productTypeId) || productTypeId <= 0) {
    const notFound: ApiResponse<null> = { success: false, data: null, error: 'not_found' }
    return c.json(notFound, 404)
  }

  // Rate-limit double-tap (reuse consumeToken + PURCHASE_RULE) → 429. Key theo telegram_id (Req 16.3).
  const verdict = consumeToken(`app:buy:${user.telegram_id}`, PURCHASE_RULE)
  if (!verdict.allowed) {
    const limited: ApiResponse<null> = { success: false, data: null, error: 'rate_limited' }
    return c.json(limited, 429)
  }

  // Lấy product_type đang hiển thị — ẩn/không tồn tại → 404 (Req 5.4).
  const pt = await c.env.DB.prepare('SELECT * FROM product_types WHERE id = ? AND is_visible = 1')
    .bind(productTypeId)
    .first<DbProductType>()
  if (!pt) {
    const notFound: ApiResponse<null> = { success: false, data: null, error: 'not_found' }
    return c.json(notFound, 404)
  }

  // Tổng tiền tính server-side (Req 6.1, 16.3) — KHÔNG tin client.
  const totalAmount = pt.price * quantity

  // Giao dịch atomic (Req 6.2..6.5, 16.2) — reuse nguyên service, truyền pt.price làm unitPrice.
  const result = await transactionService.executePurchase(c.env.DB, user.id, pt.id, quantity, pt.price)

  if (!result.success) {
    const statusByError = {
      insufficient_balance: 409,
      insufficient_stock: 409,
      db_error: 500,
    } as const
    const errorCode = result.error ?? 'db_error'
    const fail: ApiResponse<null> = { success: false, data: null, error: errorCode }
    return c.json(fail, statusByError[errorCode])
  }

  const products = result.products ?? []
  const contents = products.map((p) => p.content)
  // executePurchase đã guard `WHERE balance >= total` nên balanceAfter phản ánh đúng số dư đã commit.
  const balanceAfter = user.balance - totalAmount

  // Đồng bộ bot SAU commit (Req 7) — fire-and-forget, lỗi gửi tin KHÔNG rollback (Req 7.5).
  // renderSuccessMessage tự escape giá trị động (content/name) (Req 7.4, 15.1).
  const html = renderSuccessMessage(pt.success_template, {
    emoji: pt.emoji,
    name: pt.name,
    quantity,
    totalAmount,
    balanceAfter,
    contents,
  })
  const notify = sendMessage(c.env.BOT_TOKEN, user.telegram_id, html, { parse_mode: 'HTML' }).catch(
    (err) => console.error('[MiniApp] notify purchase failed:', err)
  )
  c.executionCtx?.waitUntil?.(notify)

  // Trả nội dung tài khoản + số dư mới cho app (Req 6.6, 6.7).
  const data: PurchaseResultDto = {
    order_id: result.order?.id ?? 0,
    quantity,
    total_amount: totalAmount,
    new_balance: balanceAfter,
    new_balance_display: formatCurrency(balanceAfter),
    contents,
  }

  const body: ApiResponse<PurchaseResultDto> = {
    success: true,
    data,
    error: null,
  }

  return c.json(body)
})

/**
 * Đọc giới hạn số tiền nạp từ `system_config` (Req 8.2).
 *
 * SELECT cả hai key `min_deposit`/`max_deposit` trong một query, parse `Number`.
 * Giá trị thiếu/không hợp lệ (rỗng, không phải số nguyên dương) → dùng fallback
 * (`DEFAULT_MIN_DEPOSIT`/`DEFAULT_MAX_DEPOSIT`) để không chặn nhầm nạp hợp lệ khi
 * config bị lỗi. Nếu `min > max` (config mâu thuẫn) → hoán đổi để khoảng luôn hợp lệ.
 */
async function readDepositLimits(db: D1Database): Promise<{ min: number; max: number }> {
  const { results } = await db
    .prepare("SELECT key, value FROM system_config WHERE key IN ('min_deposit', 'max_deposit')")
    .all<{ key: string; value: string }>()

  const byKey = new Map(results.map((r) => [r.key, r.value]))
  let min = parsePositiveInt(byKey.get('min_deposit'), DEFAULT_MIN_DEPOSIT)
  let max = parsePositiveInt(byKey.get('max_deposit'), DEFAULT_MAX_DEPOSIT)
  if (min > max) [min, max] = [max, min]
  return { min, max }
}

/** Parse chuỗi config sang số nguyên dương; không hợp lệ → fallback. */
function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

/** Tham số dựng caption tin nhắn VietQR cho yêu cầu nạp. */
interface DepositCaptionParams {
  bank: string
  account: string
  owner: string
  amount: number
  transferCode: string
}

/**
 * Dựng caption HTML cho ảnh VietQR gửi qua bot khi tạo yêu cầu nạp (Req 10.1).
 *
 * Mirror nội dung "Thông tin chuyển khoản" của flow bot (`handleDepositAmount`).
 * ESCAPE HTML cho mọi giá trị động (`bank`, `account`, `owner`, `transferCode`) vì nay
 * thông tin ngân hàng lấy từ `system_config` (admin nhập qua CMS) — ký tự đặc biệt không
 * được phá vỡ HTML/khỏi rủi ro injection (Req 10.3, 15.1). `amount` là số nguyên đã
 * `formatCurrency`.
 */
function buildDepositCaption(params: DepositCaptionParams): string {
  const { bank, account, owner, amount, transferCode } = params
  return [
    '💸 <b>Thông tin chuyển khoản</b>',
    '',
    `🏦 Ngân hàng: <b>${escapeHtml(bank)}</b>`,
    `💳 Số TK: <code>${escapeHtml(account)}</code>`,
    `👤 Chủ TK: <b>${escapeHtml(owner)}</b>`,
    `💰 Số tiền: <b>${formatCurrency(amount)}</b>`,
    `📝 Nội dung CK: <code>${escapeHtml(transferCode)}</code>`,
    '',
    '⚠️ <b>QUAN TRỌNG: Gõ đúng y chang nội dung CK!</b>',
    '🤖 Hệ thống tự động duyệt khi CK đúng nội dung (1-3 phút).',
  ].join('\n')
}

/**
 * POST /deposits — Tạo yêu cầu nạp + VietQR (Req 8.1, 8.2, 8.3, 8.4, 8.5, 10.1, 10.3, 10.4).
 *
 * Controller mỏng: validate khoảng số tiền theo `system_config` → rate-limit → huỷ pending
 * cũ → tạo `deposits` pending với `transfer_code` duy nhất → dựng `qr_url` VietQR → đồng bộ
 * ảnh QR qua bot sau commit. Người mua định danh qua `c.get('user')`; `transfer_code` sinh
 * theo `telegram_id` (khớp flow bot `handleDepositAmount`).
 *
 * Request body: `{ amount: number }` (đọc qua `c.req.json()`).
 *
 * Luồng mã lỗi:
 *  - JSON hỏng / `amount` không phải integer trong `[min_deposit, max_deposit]` → 400 với message
 *    nêu rõ giới hạn (đã `formatCurrency`); KHÔNG tạo bản ghi `deposits` (Req 8.2).
 *  - vi phạm luật nạp dùng chung (`checkDepositPolicy`): quá 3 deposit pending còn hiệu lực
 *    hoặc chưa qua cooldown 5 phút → 429 với `error` là message tiếng Việt cụ thể.
 *
 * Sau commit (Req 10.1): dựng caption qua `buildDepositCaption` (escape giá trị động — Req 10.3)
 * rồi `sendPhoto` fire-and-forget qua `c.executionCtx.waitUntil(promise.catch(log))` — lỗi gửi tin
 * KHÔNG rollback yêu cầu nạp đã tạo (Req 10.4). Trả `DepositCreatedDto`.
 */
miniAppApi.post('/deposits', async (c) => {
  const user = c.get('user')

  // Đọc body — guard JSON hỏng → coi là input không hợp lệ (Req 8.2).
  let payload: { amount?: unknown }
  try {
    payload = await c.req.json()
  } catch {
    const limits = await readDepositLimits(c.env.DB)
    return c.json(depositRangeError(limits), 400)
  }

  const amount = Number(payload.amount)

  // Validate khoảng số tiền theo system_config (Req 8.2) — ngoài khoảng → 400, KHÔNG tạo deposit.
  const limits = await readDepositLimits(c.env.DB)
  if (!Number.isInteger(amount) || amount < limits.min || amount > limits.max) {
    return c.json(depositRangeError(limits), 400)
  }

  // Luật nạp dùng chung với bot (D1-backed): cooldown 5 phút + tối đa 3 deposit pending
  // còn hiệu lực → 429 kèm message cụ thể (Req 8.3). Key nghiệp vụ theo users.id.
  const verdict = await checkDepositPolicy(c.env.DB, user.id)
  if (!verdict.allowed) {
    const limited: ApiResponse<null> = {
      success: false,
      data: null,
      error: depositPolicyMessage(verdict),
    }
    return c.json(limited, 429)
  }

  // transfer_code sinh theo telegram_id để khớp flow bot (Req 8.3).
  const transferCode = generateTransferCode(user.telegram_id)
  const now = new Date().toISOString()
  const inserted = await c.env.DB.prepare(
    "INSERT INTO deposits (user_id, transfer_code, amount, status, created_at) VALUES (?, ?, ?, 'pending', ?) RETURNING id"
  )
    .bind(user.id, transferCode, amount, now)
    .first<{ id: number }>()

  // Thông tin ngân hàng: DB (system_config) ưu tiên, fallback env Worker (Req 8.4).
  const bank = await resolveBankConfig(c.env.DB, c.env)

  // Dựng VietQR URL (Req 8.4) — addInfo = transfer_code để SePay đối soát.
  const qrUrl = generateVietQRUrl({
    bankId: bank.bankName,
    accountNo: bank.bankAccount,
    accountName: bank.bankOwner,
    amount,
    description: transferCode,
  })

  // Đồng bộ bot SAU commit (Req 10.1) — gửi ảnh VietQR + caption fire-and-forget,
  // lỗi gửi tin chỉ log, KHÔNG rollback yêu cầu nạp đã tạo (Req 10.4).
  const caption = buildDepositCaption({
    bank: bank.bankName,
    account: bank.bankAccount,
    owner: bank.bankOwner,
    amount,
    transferCode,
  })
  const notify = sendPhoto(c.env.BOT_TOKEN, user.telegram_id, qrUrl, {
    caption,
    parse_mode: 'HTML',
  }).catch((err) => console.error('[MiniApp] notify deposit failed:', err))
  c.executionCtx?.waitUntil?.(notify)

  // Trả thông tin chuyển khoản + VietQR cho app (Req 8.4, 8.5).
  const data: DepositCreatedDto = {
    deposit_id: inserted?.id ?? 0,
    transfer_code: transferCode,
    amount,
    amount_display: formatCurrency(amount),
    bank_name: bank.bankName,
    bank_account: bank.bankAccount,
    bank_owner: bank.bankOwner,
    qr_url: qrUrl,
    status: 'pending',
  }

  const body: ApiResponse<DepositCreatedDto> = {
    success: true,
    data,
    error: null,
  }

  return c.json(body)
})

/** Dựng lỗi 400 cho số tiền nạp ngoài khoảng, message nêu rõ giới hạn (Req 8.2). */
function depositRangeError(limits: { min: number; max: number }): ApiResponse<null> {
  return {
    success: false,
    data: null,
    error: `Số tiền nạp phải từ ${formatCurrency(limits.min)} đến ${formatCurrency(limits.max)}`,
  }
}

/**
 * GET /deposits/:id — Trạng thái yêu cầu nạp để frontend poll (Req 8.5, 9.1).
 *
 * READ-ONLY: chỉ đọc trạng thái deposit cho frontend poll (`pending` → `completed`).
 * Việc cộng tiền + chuyển `deposits` sang `completed` do `/webhook/sepay` đảm nhận (Req 9.1);
 * endpoint này TUYỆT ĐỐI KHÔNG sửa `balance` hay bản ghi `deposits`.
 *
 * Guard chủ sở hữu: SELECT `WHERE id = ? AND user_id = ?` (`user.id` từ `c.get('user')`).
 * Deposit không tồn tại HOẶC không thuộc người mua hiện tại đều trả 404 `not_found` —
 * KHÔNG phân biệt hai trường hợp để tránh dò ID (đồng bộ ngữ nghĩa với `GET /orders/:id`).
 *
 * `:id` parse sang integer — không hợp lệ → 404.
 *
 * Trả `DepositStatusDto` `{ deposit_id, status, amount, new_balance? }`. `new_balance` CHỈ
 * có khi `status === 'completed'`, set bằng số dư HIỆN TẠI của người mua (`user.balance` —
 * phản ánh bản ghi `users` mới nhất từ upsert/select của middleware sau khi SePay cộng tiền).
 */
miniAppApi.get('/deposits/:id', async (c) => {
  const user = c.get('user')

  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    const notFound: ApiResponse<null> = { success: false, data: null, error: 'not_found' }
    return c.json(notFound, 404)
  }

  // Guard chủ sở hữu — chỉ lấy deposit thuộc user.id (chống dò ID/IDOR). Chỉ đọc.
  const deposit = await c.env.DB.prepare('SELECT id, status, amount FROM deposits WHERE id = ? AND user_id = ?')
    .bind(id, user.id)
    .first<Pick<DbDeposit, 'id' | 'status' | 'amount'>>()

  // Không tồn tại HOẶC không thuộc người mua → 404 (không phân biệt) (Req 9.1).
  if (!deposit) {
    const notFound: ApiResponse<null> = { success: false, data: null, error: 'not_found' }
    return c.json(notFound, 404)
  }

  const data: DepositStatusDto = {
    deposit_id: deposit.id,
    status: deposit.status,
    amount: deposit.amount,
  }

  // new_balance CHỈ trả khi đã completed — số dư hiện tại từ middleware (Req 8.5).
  // Endpoint chỉ đọc; số dư đã được /webhook/sepay cộng trước đó (Req 9.1).
  if (deposit.status === 'completed') {
    data.new_balance = user.balance
  }

  const body: ApiResponse<DepositStatusDto> = {
    success: true,
    data,
    error: null,
  }

  return c.json(body)
})

/**
 * Phân trang lịch sử đơn hàng (Req 11.1).
 *
 * `page` mặc định 1 (tối thiểu 1); `limit` mặc định 20, trần 100 để tránh
 * client yêu cầu trang quá lớn gây tải DB. Giá trị không hợp lệ → fallback default.
 */
const DEFAULT_ORDERS_PAGE = 1
const DEFAULT_ORDERS_LIMIT = 20
const MAX_ORDERS_LIMIT = 100

/** Parse query `page` sang integer ≥ 1; không hợp lệ → default. */
function parseOrdersPage(raw: string | undefined): number {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_ORDERS_PAGE
}

/** Parse query `limit` sang integer trong `[1, MAX_ORDERS_LIMIT]`; không hợp lệ → default. */
function parseOrdersLimit(raw: string | undefined): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) return DEFAULT_ORDERS_LIMIT
  return Math.min(n, MAX_ORDERS_LIMIT)
}

/** Một dòng kết quả query danh sách/chi tiết đơn hàng (Req 11.1, 11.2, 11.3). */
interface OrderRow {
  id: number
  quantity: number
  total_amount: number
  status: 'completed' | 'refunded'
  created_at: string
  product_name: string // pt.name AS product_name
  emoji: string
}

/**
 * GET /orders — Lịch sử đơn hàng của người mua hiện tại (Req 11.1, 11.2, 11.4).
 *
 * Cô lập dữ liệu theo người mua: query `WHERE o.user_id = ?` với `user.id` lấy từ
 * `c.get('user')` (đã JOIN/lọc qua `telegram_id`), KHÔNG nhận `user_id` từ client.
 * `JOIN product_types` để lấy `name`/`emoji`, `ORDER BY o.created_at DESC` (mới nhất
 * trước). Phân trang `LIMIT/OFFSET` theo query `page`/`limit`; `meta` mang `total`
 * (đếm cùng điều kiện WHERE), `page`, `limit`. Khi người mua chưa có đơn → trả mảng
 * rỗng `[]` (Req 11.4), `meta.total = 0`.
 */
miniAppApi.get('/orders', async (c) => {
  const user = c.get('user')

  const page = parseOrdersPage(c.req.query('page'))
  const limit = parseOrdersLimit(c.req.query('limit'))
  const offset = (page - 1) * limit

  // Đếm tổng số đơn theo cùng điều kiện WHERE để dựng meta (Req 11.1).
  const totalRow = await c.env.DB.prepare('SELECT COUNT(*) AS total FROM orders WHERE user_id = ?')
    .bind(user.id)
    .first<{ total: number }>()
  const total = totalRow?.total ?? 0

  // Trang đơn hàng — sắp xếp mới nhất trước (Req 11.1, 11.2).
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.quantity, o.total_amount, o.status, o.created_at,
            pt.name AS product_name, pt.emoji
     FROM orders o
     JOIN product_types pt ON pt.id = o.product_type_id
     WHERE o.user_id = ?
     ORDER BY o.created_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(user.id, limit, offset)
    .all<OrderRow>()

  // Mảng rỗng khi chưa có đơn (Req 11.4).
  const data: OrderListItemDto[] = results.map((row) => ({
    id: row.id,
    product_name: row.product_name,
    emoji: row.emoji,
    quantity: row.quantity,
    total_amount: row.total_amount,
    total_display: formatCurrency(row.total_amount),
    status: row.status,
    created_at: row.created_at,
  }))

  const body: ApiResponse<OrderListItemDto[]> = {
    success: true,
    data,
    error: null,
    meta: { total, page, limit },
  }

  return c.json(body)
})

/**
 * GET /orders/:id — Chi tiết đơn + nội dung tài khoản (Req 11.3, 15.3).
 *
 * Guard chủ sở hữu: SELECT `WHERE o.id = ? AND o.user_id = ?` (`user.id` từ
 * `c.get('user')`). Đơn không tồn tại HOẶC không thuộc người mua hiện tại đều trả
 * 404 `not_found` — KHÔNG phân biệt hai trường hợp để tránh dò ID (Req 15.3, chống IDOR).
 * CHỈ khi đơn thuộc người mua mới truy vấn và trả `contents` (`products.content`) — bảo
 * đảm KHÔNG lộ nội dung đơn của người khác (Req 15.3).
 *
 * `:id` parse sang integer — không hợp lệ → 404.
 */
miniAppApi.get('/orders/:id', async (c) => {
  const user = c.get('user')

  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    const notFound: ApiResponse<null> = { success: false, data: null, error: 'not_found' }
    return c.json(notFound, 404)
  }

  // Guard chủ sở hữu — chỉ lấy đơn thuộc user.id (Req 15.3). Rỗng → 404 (không phân biệt).
  const order = await c.env.DB.prepare(
    `SELECT o.id, o.quantity, o.total_amount, o.status, o.created_at,
            pt.name AS product_name, pt.emoji
     FROM orders o
     JOIN product_types pt ON pt.id = o.product_type_id
     WHERE o.id = ? AND o.user_id = ?`
  )
    .bind(id, user.id)
    .first<OrderRow>()

  if (!order) {
    const notFound: ApiResponse<null> = { success: false, data: null, error: 'not_found' }
    return c.json(notFound, 404)
  }

  // Chỉ truy vấn nội dung khi đã xác nhận đơn thuộc người mua (Req 15.3).
  const { results } = await c.env.DB.prepare(
    `SELECT p.content
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = ?`
  )
    .bind(order.id)
    .all<{ content: string }>()

  const data: OrderDetailDto = {
    id: order.id,
    product_name: order.product_name,
    emoji: order.emoji,
    quantity: order.quantity,
    total_amount: order.total_amount,
    total_display: formatCurrency(order.total_amount),
    status: order.status,
    created_at: order.created_at,
    contents: results.map((r) => r.content),
  }

  const body: ApiResponse<OrderDetailDto> = {
    success: true,
    data,
    error: null,
  }

  return c.json(body)
})

export { miniAppApi }