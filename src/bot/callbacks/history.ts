/**
 * Callback handler: Lịch sử đơn hàng.
 * Hiển thị 10 orders gần nhất với thông tin category, qty, total, datetime.
 * Requirements: 4.7, 4.8
 */

import { editOrSendMessage, buildInlineKeyboard, buildBackButton } from '../telegram-api'
import { formatCurrency, formatDate } from '../../utils/format'

interface OrderRow {
  quantity: number
  total_amount: number
  created_at: string
  name: string
  emoji: string
}

/**
 * Hiển thị lịch sử 10 đơn hàng gần nhất của user.
 * Nếu không có đơn hàng → thông báo "chưa có đơn hàng".
 */
export async function handleHistory(
  db: D1Database,
  botToken: string,
  chatId: number,
  messageId: number | undefined,
  userId: number
): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT o.quantity, o.total_amount, o.created_at, pt.name, pt.emoji
       FROM orders o
       JOIN product_types pt ON pt.id = o.product_type_id
       JOIN users u ON u.id = o.user_id
       WHERE u.telegram_id = ?
       ORDER BY o.created_at DESC
       LIMIT 10`
    )
    .bind(userId)
    .all<OrderRow>()

  let text: string

  if (!results || results.length === 0) {
    text = '📜 Chưa có đơn hàng nào.'
  } else {
    const lines = results.map((order) => {
      const totalFormatted = formatCurrency(order.total_amount)
      const dateFormatted = formatDate(order.created_at)
      return `${order.emoji} ${order.name} × ${order.quantity} — ${totalFormatted} | ${dateFormatted}`
    })

    text = `📜 <b>Lịch sử đơn hàng</b>\n\n${lines.join('\n')}`
  }

  const keyboard = buildInlineKeyboard([buildBackButton('menu:main')])

  await editOrSendMessage(botToken, chatId, messageId, text, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  })
}
