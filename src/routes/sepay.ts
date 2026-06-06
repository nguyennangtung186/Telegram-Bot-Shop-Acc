/**
 * SePay Webhook Route — xử lý callback từ SePay khi có giao dịch banking.
 * Requirements: 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 8.2, 8.5
 */
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import type { SepayWebhookPayload } from '../types/sepay'
import type { DbDeposit, DbUser } from '../types/db'
import { sepayAuth } from '../middleware/sepay-auth'
import { transactionService } from '../services/transaction'
import { DEPOSIT_TTL_MS } from '../services/deposit-policy'
import { sendMessage } from '../bot/telegram-api'
import { formatCurrency } from '../utils/format'

const TRANSFER_CODE_REGEX = /NAP[A-Z0-9]{4,17}/i
const MIN_AMOUNT = 20_000
const MAX_AMOUNT = 100_000_000

const sepayWebhook = new Hono<AppEnv>()

// Apply sepay-auth middleware — returns 401 if auth fails
sepayWebhook.use('/sepay', sepayAuth)

sepayWebhook.post('/sepay', async (c) => {
  const db = c.env.DB
  const botToken = c.env.BOT_TOKEN

  // Parse payload
  let payload: SepayWebhookPayload
  try {
    payload = await c.req.json<SepayWebhookPayload>()
  } catch {
    return c.json({ success: true })
  }

  // Chỉ xử lý giao dịch tiền vào (Req 2.5)
  if (payload.transferType !== 'in') {
    return c.json({ success: true })
  }

  // Idempotency check: kiểm tra sepay_transaction_id đã xử lý chưa (Req 2.12)
  const existingDeposit = await db
    .prepare('SELECT id FROM deposits WHERE sepay_transaction_id = ?')
    .bind(String(payload.id))
    .first<{ id: number }>()

  if (existingDeposit) {
    return c.json({ success: true })
  }

  // Extract transfer_code từ content (Req 2.6)
  const match = payload.content.match(TRANSFER_CODE_REGEX)
  if (!match) {
    console.warn('[SePay] No transfer code found in content:', payload.content)
    return c.json({ success: true })
  }

  const transferCode = match[0].toUpperCase()

  // Find pending deposit by transfer_code (Req 2.7). Kèm tuổi (giây) để áp luật TTL.
  const deposit = await db
    .prepare(
      `SELECT *, strftime('%s','now') - strftime('%s', created_at) AS age_sec
       FROM deposits WHERE transfer_code = ? AND status = 'pending'`
    )
    .bind(transferCode)
    .first<DbDeposit & { age_sec: number }>()

  if (!deposit) {
    console.warn('[SePay] No pending deposit found for transfer_code:', transferCode)
    return c.json({ success: true })
  }

  // TTL: chuyển khoản tới sau khi deposit đã quá hạn (15 phút) thì KHÔNG được tính.
  // Cron sẽ dọn trạng thái sang 'expired'; ở đây chỉ cần bỏ qua việc cộng tiền.
  if (deposit.age_sec * 1000 > DEPOSIT_TTL_MS) {
    console.warn('[SePay] Deposit expired (>15m), skip crediting. transfer_code:', transferCode)
    return c.json({ success: true })
  }

  // Validate amount range (Req 2.8)
  if (payload.transferAmount < MIN_AMOUNT || payload.transferAmount > MAX_AMOUNT) {
    console.warn('[SePay] Amount out of range:', payload.transferAmount)
    return c.json({ success: true })
  }

  // Get user info
  const user = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(deposit.user_id)
    .first<DbUser>()

  if (!user) {
    console.warn('[SePay] User not found for deposit:', deposit.id)
    return c.json({ success: true })
  }

  // Execute deposit transaction (Req 2.9, 2.10)
  const result = await transactionService.executeDeposit(
    db,
    deposit.id,
    user.id,
    payload.transferAmount,
    String(payload.id)
  )

  // Gửi notification cho user nếu thành công (Req 2.11) — async via waitUntil
  if (result.success && result.newBalance !== undefined) {
    const notificationText = [
      '✅ Nạp tiền thành công!',
      '',
      `💰 Số tiền: ${formatCurrency(payload.transferAmount)}`,
      `💳 Số dư mới: ${formatCurrency(result.newBalance)}`,
      '',
      '🛒 Bạn có thể mua hàng ngay!',
    ].join('\n')

    // Fire-and-forget notification (waitUntil pattern for CF Workers)
    const notificationPromise = sendMessage(botToken, user.telegram_id, notificationText, {
      parse_mode: 'HTML',
    }).catch((err) => {
      console.error('[SePay] Failed to send notification:', err)
    })

    // Use waitUntil if available (Cloudflare Workers ExecutionContext)
    if (c.executionCtx?.waitUntil) {
      c.executionCtx.waitUntil(notificationPromise)
    }
  }

  // Luôn return success (Req 8.5)
  return c.json({ success: true })
})

export { sepayWebhook }
