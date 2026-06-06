/**
 * Callback handler: Thông tin tài khoản.
 * Hiển thị username, first_name, balance, tổng transactions, ngày tham gia.
 * Requirements: 1.4
 */

import { editOrSendMessage, buildInlineKeyboard, buildBackButton } from '../telegram-api'
import { formatCurrency, formatDate } from '../../utils/format'

interface UserInfo {
  id: number
  username: string | null
  first_name: string | null
  balance: number
  created_at: string
}

/**
 * Hiển thị thông tin tài khoản user: username, tên, số dư, tổng giao dịch, ngày tham gia.
 */
export async function handleAccount(
  db: D1Database,
  botToken: string,
  chatId: number,
  messageId: number | undefined,
  userId: number
): Promise<void> {
  const user = await db
    .prepare(
      `SELECT id, username, first_name, balance, created_at
       FROM users
       WHERE telegram_id = ?`
    )
    .bind(userId)
    .first<UserInfo>()

  if (!user) {
    await editOrSendMessage(botToken, chatId, messageId, '❌ Không tìm thấy thông tin tài khoản.', {
      reply_markup: buildInlineKeyboard([buildBackButton('menu:main')]),
    })
    return
  }

  const txCount = await db
    .prepare(`SELECT COUNT(*) as count FROM transactions WHERE user_id = ?`)
    .bind(user.id)
    .first<{ count: number }>()

  const usernameDisplay = user.username ? `@${user.username}` : 'Chưa có'
  const nameDisplay = user.first_name || 'Chưa có'
  const balanceDisplay = formatCurrency(user.balance)
  const txDisplay = txCount?.count ?? 0
  const joinDateDisplay = formatDate(user.created_at)

  const text = [
    '👤 <b>Thông tin tài khoản</b>\n',
    `👤 Username: ${usernameDisplay}`,
    `📛 Tên: ${nameDisplay}`,
    `💰 Số dư: ${balanceDisplay}`,
    `📊 Tổng giao dịch: ${txDisplay}`,
    `📅 Ngày tham gia: ${joinDateDisplay}`,
  ].join('\n')

  const keyboard = buildInlineKeyboard([buildBackButton('menu:main')])

  await editOrSendMessage(botToken, chatId, messageId, text, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  })
}
