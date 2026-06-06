/**
 * Deposit flow handlers — nạp tiền qua SePay.
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.13, 7.3
 */

import type { DbDeposit } from '../../types/db'
import type { Bindings } from '../../types/bindings'
import {
  sendMessage,
  sendPhoto,
  editOrSendMessage,
  editMessageText,
  buildInlineKeyboard,
} from '../telegram-api'
import { generateTransferCode } from '../../utils/transfer-code'
import { generateVietQRUrl } from '../../utils/vietqr'
import { formatCurrency } from '../../utils/format'
import { escapeHtml } from '../../utils/telegram-template'
import { getSession, setSession, clearSession } from '../session'
import { shouldSendNotice } from '../rate-limit'
import { checkDepositPolicy, depositPolicyMessage } from '../../services/deposit-policy'
import { readDepositLimits } from '../../services/deposit-limits'
import { resolveBankConfig } from '../../services/bank-config'

/** Mệnh giá nạp nhanh (grid 2×3) */
const PRESET_AMOUNTS = [30_000, 50_000, 100_000, 200_000, 500_000, 1_000_000]

/**
 * Hiển thị menu chọn mệnh giá nạp tiền (grid 2×3).
 * Callback: `dep:menu`
 */
export async function handleDepositMenu(
  db: D1Database,
  botToken: string,
  chatId: number,
  userId: number,
  messageId?: number
): Promise<void> {
  // Set session to deposit flow, step 'amount'
  setSession(userId, 'deposit', 'amount')

  // Hạn mức lấy từ system_config (admin chỉnh qua CMS) — đồng bộ với Mini App + webhook SePay.
  const { min: minAmount } = await readDepositLimits(db)

  const text = [
    '💰 <b>Nạp tiền</b>',
    '',
    'Chọn mệnh giá hoặc nhập số tiền tùy ý:',
    '',
    `💡 Tối thiểu: <b>${formatCurrency(minAmount)}</b>`,
    '📝 Gõ /huy để huỷ giao dịch',
  ].join('\n')

  // Build grid 2×3 inline keyboard
  const rows: { text: string; callback_data: string }[][] = []
  for (let i = 0; i < PRESET_AMOUNTS.length; i += 2) {
    const row = PRESET_AMOUNTS.slice(i, i + 2).map((amount) => ({
      text: formatCurrency(amount),
      callback_data: `dep:${amount}`,
    }))
    rows.push(row)
  }
  // Nút huỷ
  rows.push([{ text: '❌ Huỷ', callback_data: 'dep:cancel' }])

  const res = await editOrSendMessage(botToken, chatId, messageId, text, {
    parse_mode: 'HTML',
    reply_markup: buildInlineKeyboard(rows),
  })

  // Lưu messageId của menu mệnh giá vào session để ẩn (gỡ nút) khi đã tạo QR,
  // tránh user bấm lại spam tạo deposit + QR. Áp dụng cho cả nhập số tiền tùy ý.
  const menuMessageId = (res.result as { message_id?: number } | undefined)?.message_id
  if (menuMessageId) {
    setSession(userId, 'deposit', 'amount', { menuMessageId })
  }
}

/**
 * Xử lý chọn mệnh giá / nhập số tiền → tạo deposit pending + hiển thị QR.
 * Callback: `dep:{amount}` hoặc text input khi session flow='deposit' step='amount'
 */
export async function handleDepositAmount(
  db: D1Database,
  botToken: string,
  chatId: number,
  userId: number,
  amount: number,
  env: Bindings
): Promise<void> {
  // Validate amount theo hạn mức cấu hình (min/max) trong system_config — đồng bộ với
  // Mini App (`POST /deposits`) và webhook SePay. Trước đây bot hardcode min = 20.000 và
  // KHÔNG kiểm max → lệch luật khi admin đổi cấu hình qua CMS.
  const { min: minAmount, max: maxAmount } = await readDepositLimits(db)
  if (isNaN(amount) || amount < minAmount || amount > maxAmount) {
    await sendMessage(
      botToken,
      chatId,
      `⚠️ Số tiền nạp phải từ <b>${formatCurrency(minAmount)}</b> đến <b>${formatCurrency(maxAmount)}</b>. Vui lòng nhập lại.`,
      { parse_mode: 'HTML' }
    )
    return
  }

  // Lấy user.id từ telegram_id (cần cho cả kiểm tra luật nạp lẫn insert).
  const user = await db
    .prepare('SELECT id FROM users WHERE telegram_id = ?')
    .bind(userId)
    .first<{ id: number }>()

  if (!user) {
    await sendMessage(botToken, chatId, '❌ Không tìm thấy tài khoản. Gõ /start để bắt đầu.')
    return
  }

  // Luật nạp dùng chung (D1-backed): cooldown 5 phút + tối đa 3 deposit pending còn hiệu lực.
  const verdict = await checkDepositPolicy(db, user.id)
  if (!verdict.allowed) {
    // Throttle thông báo để không spam ngược user khi bấm liên tục (flood đã chặn ở tầng trên).
    if (shouldSendNotice(`dep:${userId}`)) {
      await sendMessage(botToken, chatId, depositPolicyMessage(verdict), { parse_mode: 'HTML' })
    }
    return
  }

  // Lấy messageId của menu mệnh giá (nếu có) để ẩn nút sau khi tạo QR.
  const menuMessageId = getSession(userId)?.data?.menuMessageId as number | undefined

  // Generate transfer code
  const transferCode = generateTransferCode(userId)
  const now = new Date().toISOString()

  // Insert deposit pending
  await db
    .prepare(
      `INSERT INTO deposits (user_id, transfer_code, amount, status, created_at) VALUES (?, ?, ?, 'pending', ?)`
    )
    .bind(user.id, transferCode, amount, now)
    .run()

  // Ẩn lưới mệnh giá: gỡ toàn bộ nút trên menu để user không bấm lại spam tạo QR.
  if (menuMessageId) {
    await editMessageText(
      botToken,
      chatId,
      menuMessageId,
      [
        '💰 <b>Nạp tiền</b>',
        '',
        `✅ Đã tạo yêu cầu nạp <b>${formatCurrency(amount)}</b>.`,
        '👇 Quét mã QR bên dưới để chuyển khoản.',
      ].join('\n'),
      { parse_mode: 'HTML' }
    )
  }

  // Thông tin ngân hàng: DB (system_config) ưu tiên, fallback env Worker.
  const bank = await resolveBankConfig(db, env)

  // Generate VietQR URL
  const qrUrl = generateVietQRUrl({
    bankId: bank.bankName,
    accountNo: bank.bankAccount,
    accountName: bank.bankOwner,
    amount,
    description: transferCode,
  })

  // Send QR code image
  await sendPhoto(botToken, chatId, qrUrl, {
    caption: '📱 Quét mã QR để chuyển khoản',
    parse_mode: 'HTML',
  })

  // Send transfer details
  const detailText = [
    '💸 <b>Thông tin chuyển khoản</b>',
    '',
    `🏦 Ngân hàng: <b>${escapeHtml(bank.bankName)}</b>`,
    `💳 Số TK: <code>${escapeHtml(bank.bankAccount)}</code>`,
    `👤 Chủ TK: <b>${escapeHtml(bank.bankOwner)}</b>`,
    `💰 Số tiền: <b>${formatCurrency(amount)}</b>`,
    `📝 Nội dung CK: <code>${transferCode}</code>`,
    '',
    '⚠️ <b>QUAN TRỌNG: Gõ đúng y chang nội dung CK!</b>',
    '',
    '⚠️ Sai nội dung hoặc sai số tiền → không tự duyệt được.',
    '🤖 Hệ thống tự động duyệt khi CK đúng nội dung (1-3 phút).',
    'Không cần liên hệ admin.',
  ].join('\n')

  const cancelKeyboard = buildInlineKeyboard([
    [{ text: '❌ Huỷ giao dịch', callback_data: 'dep:cancel' }],
  ])

  await sendMessage(botToken, chatId, detailText, {
    parse_mode: 'HTML',
    reply_markup: cancelKeyboard,
  })

  // Clear session — user đã nhận QR, không cần giữ flow nữa
  clearSession(userId)
}

/**
 * Huỷ deposit đang chờ.
 * Callback: `dep:cancel` hoặc lệnh /huy
 */
export async function handleDepositCancel(
  db: D1Database,
  botToken: string,
  chatId: number,
  userId: number,
  messageId?: number
): Promise<void> {
  // Lấy user.id từ telegram_id
  const user = await db
    .prepare('SELECT id FROM users WHERE telegram_id = ?')
    .bind(userId)
    .first<{ id: number }>()

  if (!user) {
    await sendMessage(botToken, chatId, '❌ Không tìm thấy tài khoản. Gõ /start để bắt đầu.')
    return
  }

  // Tìm deposit pending của user
  const pendingDeposit = await db
    .prepare(
      `SELECT id, amount, transfer_code FROM deposits WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`
    )
    .bind(user.id)
    .first<Pick<DbDeposit, 'id' | 'amount' | 'transfer_code'>>()

  // Clear session
  clearSession(userId)

  if (!pendingDeposit) {
    const text = '📌 Không có giao dịch nạp tiền nào đang chờ.'
    await editOrSendMessage(botToken, chatId, messageId, text, {
      parse_mode: 'HTML',
    })
    return
  }

  // Cancel deposit
  await db
    .prepare(`UPDATE deposits SET status = 'cancelled' WHERE id = ?`)
    .bind(pendingDeposit.id)
    .run()

  const text = [
    '✅ Đã huỷ giao dịch nạp tiền.',
    '',
    `💰 Mệnh giá: ${formatCurrency(pendingDeposit.amount)}`,
    `📝 Mã CK: <code>${pendingDeposit.transfer_code}</code>`,
    '',
    '📌 Gõ /start để quay về menu chính.',
  ].join('\n')

  await editOrSendMessage(botToken, chatId, messageId, text, {
    parse_mode: 'HTML',
  })
}
