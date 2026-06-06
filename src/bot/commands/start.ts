/**
 * /start command handler — đăng ký/cập nhật user và hiển thị menu chính.
 * Requirements: 1.1, 1.2, 1.3, 1.5, 7.1, 7.2, 7.10
 */

import type { TelegramUser } from '../../types/telegram'
import type { DbUser } from '../../types/db'
import { sendMessage, buildMainMenu, buildInlineKeyboard } from '../telegram-api'
import { formatCurrency } from '../../utils/format'
import { handleBotError } from '../../utils/error-handler'

/**
 * Handle /start command:
 * 1. Upsert user (create or update telegram info)
 * 2. Fetch shop name from system_config
 * 3. Send welcome message with Reply Keyboard menu
 */
export async function handleStart(
  db: D1Database,
  botToken: string,
  chatId: number,
  from: TelegramUser
): Promise<void> {
  try {
    const now = new Date().toISOString()
    const telegramId = from.id
    const username = from.username ?? null
    const firstName = from.first_name ?? null

    // Query existing user by telegram_id
    const existingUser = await db
      .prepare('SELECT * FROM users WHERE telegram_id = ?')
      .bind(telegramId)
      .first<DbUser>()

    let balance = 0

    if (!existingUser) {
      // Create new user
      await db
        .prepare(
          `INSERT INTO users (telegram_id, username, first_name, balance, is_active, last_interaction_at, created_at, updated_at)
           VALUES (?, ?, ?, 0, 1, ?, ?, ?)`
        )
        .bind(telegramId, username, firstName, now, now, now)
        .run()
    } else {
      // Update existing user info + last_interaction_at
      balance = existingUser.balance
      await db
        .prepare(
          `UPDATE users SET username = ?, first_name = ?, last_interaction_at = ?, updated_at = ?
           WHERE telegram_id = ?`
        )
        .bind(username, firstName, now, now, telegramId)
        .run()
    }

    // Fetch shop name from system_config (fallback to default)
    const shopConfig = await db
      .prepare("SELECT value FROM system_config WHERE key = 'shop_name'")
      .first<{ value: string }>()

    const shopName = shopConfig?.value ?? 'Telegram Shop Bot'

    // Build welcome message
    const displayName = firstName ?? 'bạn'
    const welcomeText = [
      `🏪 <b>${shopName}</b>`,
      '',
      `Xin chào <b>${displayName}</b>! 👋`,
      `💰 Số dư: <b>${formatCurrency(balance)}</b>`,
      // '',
      // '📌 Chọn chức năng bên dưới để bắt đầu:',
    ].join('\n')

    // 1. Welcome + reply keyboard sticky (4 nút dưới khung chat)
    await sendMessage(botToken, chatId, welcomeText, {
      parse_mode: 'HTML',
      reply_markup: buildMainMenu(),
    })

    // 2. Inline action shortcuts để bấm trực tiếp trong message
    await sendMessage(botToken, chatId, '⚡ <b>Truy cập nhanh</b>', {
      parse_mode: 'HTML',
      reply_markup: buildInlineKeyboard([
        [
          { text: '🛒 Mua hàng', callback_data: 'cat:list' },
          { text: '💰 Nạp tiền', callback_data: 'dep:menu' },
        ],
        [
          { text: '📜 Lịch sử', callback_data: 'hist' },
          { text: '👤 Số dư', callback_data: 'acc' },
        ],
      ]),
    })
  } catch (error) {
    const { message } = handleBotError(error, {
      userId: from.id,
      command: '/start',
      operation: 'handleStart',
    })

    // Attempt to notify user about the error
    try {
      await sendMessage(botToken, chatId, message)
    } catch {
      // If even error notification fails, silently log (already logged above)
    }
  }
}
