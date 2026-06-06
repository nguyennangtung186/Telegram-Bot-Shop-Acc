/**
 * Purchase flow handlers — flow mua tài khoản.
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 7.5, 7.6, 7.7
 */

import type { DbProductType } from '../../types/db'
import type { InlineKeyboardButton } from '../../types/telegram'
import {
  editOrSendMessage,
  sendMessage,
  buildInlineKeyboard,
  buildBackButton,
} from '../telegram-api'
import { formatCurrency } from '../../utils/format'
import { transactionService } from '../../services/transaction'
import { renderSuccessMessage } from '../../utils/telegram-template'
import { setSession } from '../session'
import {
  consumeToken,
  shouldSendNotice,
  retryAfterSeconds,
  PURCHASE_RULE,
} from '../rate-limit'

const PAGE_SIZE = 5
const MAX_QTY = 50

// --- Interfaces ---

interface CategoryWithStock {
  id: number
  name: string
  price: number
  emoji: string
  stock: number
}

// --- 1. Category List ---

/**
 * Hiển thị danh sách categories có product available, phân trang 5 items/page.
 * Callback: `cat:list` hoặc `page:cat:{pageNum}`
 */
export async function handleCategoryList(
  db: D1Database,
  botToken: string,
  chatId: number,
  messageId: number | undefined,
  page = 0
): Promise<void> {
  // Query categories có stock > 0
  const result = await db
    .prepare(
      `SELECT pt.id, pt.name, pt.price, pt.emoji,
              COUNT(p.id) as stock
       FROM product_types pt
       INNER JOIN products p ON p.type_id = pt.id AND p.status = 'available'
       WHERE pt.is_visible = 1
       GROUP BY pt.id
       HAVING stock > 0
       ORDER BY pt.sort_order ASC, pt.name ASC`
    )
    .all<CategoryWithStock>()

  const categories = result.results

  if (categories.length === 0) {
    await editOrSendMessage(
      botToken,
      chatId,
      messageId,
      '📦 Hiện tại không có sản phẩm nào khả dụng.\n\nVui lòng quay lại sau!',
      {
        parse_mode: 'HTML',
        reply_markup: buildInlineKeyboard([buildBackButton('menu:main')]),
      }
    )
    return
  }

  // Paginate
  const totalPages = Math.ceil(categories.length / PAGE_SIZE)
  const safePage = Math.max(0, Math.min(page, totalPages - 1))
  const pageItems = categories.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  // Build category buttons (1 per row)
  const buttons: InlineKeyboardButton[][] = pageItems.map((cat) => [
    {
      text: `${cat.emoji} ${cat.name} — ${formatCurrency(cat.price)} (còn ${cat.stock})`,
      callback_data: `cat:${cat.id}`,
    },
  ])

  // Pagination nav buttons
  const navRow: InlineKeyboardButton[] = []
  if (safePage > 0) {
    navRow.push({ text: '⬅️ Trước', callback_data: `page:cat:${safePage - 1}` })
  }
  if (safePage < totalPages - 1) {
    navRow.push({ text: '➡️ Sau', callback_data: `page:cat:${safePage + 1}` })
  }
  if (navRow.length > 0) {
    buttons.push(navRow)
  }

  // Back button
  buttons.push(buildBackButton('menu:main'))

  const text = [
    '🛒 <b>Mua tài khoản</b>',
    '',
    `📋 Danh sách sản phẩm (trang ${safePage + 1}/${totalPages}):`,
  ].join('\n')

  await editOrSendMessage(botToken, chatId, messageId, text, {
    parse_mode: 'HTML',
    reply_markup: buildInlineKeyboard(buttons),
  })
}

// --- 2. Category Detail ---

/**
 * Hiển thị chi tiết category + grid số lượng 1-10 (5×2).
 * Callback: `cat:{id}`
 */
export async function handleCategoryDetail(
  db: D1Database,
  botToken: string,
  chatId: number,
  messageId: number | undefined,
  categoryId: number,
  userId: number
): Promise<void> {
  // Query category info + stock count
  const category = await db
    .prepare('SELECT * FROM product_types WHERE id = ?')
    .bind(categoryId)
    .first<DbProductType>()

  if (!category) {
    await editOrSendMessage(
      botToken,
      chatId,
      messageId,
      '❌ Không tìm thấy loại sản phẩm này.',
      {
        reply_markup: buildInlineKeyboard([buildBackButton('cat:list')]),
      }
    )
    return
  }

  const stockResult = await db
    .prepare(
      `SELECT COUNT(*) as stock FROM products WHERE type_id = ? AND status = 'available'`
    )
    .bind(categoryId)
    .first<{ stock: number }>()

  const stock = stockResult?.stock ?? 0

  if (stock === 0) {
    await editOrSendMessage(
      botToken,
      chatId,
      messageId,
      `${category.emoji} <b>${category.name}</b>\n\n⚠️ Sản phẩm này hiện đã hết hàng.`,
      {
        parse_mode: 'HTML',
        reply_markup: buildInlineKeyboard([buildBackButton('cat:list')]),
      }
    )
    return
  }

  // Set session for free-text quantity input
  setSession(userId, 'purchase', 'quantity', { categoryId })

  // Build info text
  const description = category.description ? `📝 ${category.description}\n` : ''
  const text = [
    `${category.emoji} <b>${category.name}</b>`,
    '',
    description,
    `💰 Giá: <b>${formatCurrency(category.price)}</b>/sản phẩm`,
    `📦 Còn lại: <b>${stock}</b> sản phẩm`,
    '',
    '🔢 Chọn số lượng muốn mua:',
    `💡 Hoặc nhập số lượng (1-${Math.min(MAX_QTY, stock)})`,
  ].join('\n')

  // Build qty grid 5×2 (rows of 5)
  const maxGrid = Math.min(10, stock)
  const qtyButtons: InlineKeyboardButton[][] = []
  for (let i = 1; i <= maxGrid; i += 5) {
    const row: InlineKeyboardButton[] = []
    for (let j = i; j < i + 5 && j <= maxGrid; j++) {
      row.push({ text: String(j), callback_data: `qty:${categoryId}:${j}` })
    }
    qtyButtons.push(row)
  }

  // Back button
  qtyButtons.push(buildBackButton('cat:list'))

  await editOrSendMessage(botToken, chatId, messageId, text, {
    parse_mode: 'HTML',
    reply_markup: buildInlineKeyboard(qtyButtons),
  })
}

// --- 3. Quantity Select (Confirmation) ---

/**
 * Hiển thị xác nhận: tổng tiền + nút "✅ Xác nhận mua".
 * Callback: `qty:{catId}:{qty}`
 */
export async function handleQuantitySelect(
  db: D1Database,
  botToken: string,
  chatId: number,
  messageId: number | undefined,
  categoryId: number,
  quantity: number,
  userId: number
): Promise<void> {
  // Validate quantity
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_QTY) {
    await editOrSendMessage(
      botToken,
      chatId,
      messageId,
      `⚠️ Số lượng không hợp lệ. Vui lòng chọn từ 1 đến ${MAX_QTY}.`,
      {
        reply_markup: buildInlineKeyboard([buildBackButton(`cat:${categoryId}`)]),
      }
    )
    return
  }

  // Query category price + available stock
  const category = await db
    .prepare('SELECT * FROM product_types WHERE id = ?')
    .bind(categoryId)
    .first<DbProductType>()

  if (!category) {
    await editOrSendMessage(
      botToken,
      chatId,
      messageId,
      '❌ Không tìm thấy loại sản phẩm.',
      {
        reply_markup: buildInlineKeyboard([buildBackButton('cat:list')]),
      }
    )
    return
  }

  const stockResult = await db
    .prepare(
      `SELECT COUNT(*) as stock FROM products WHERE type_id = ? AND status = 'available'`
    )
    .bind(categoryId)
    .first<{ stock: number }>()

  const stock = stockResult?.stock ?? 0

  // Check stock >= quantity
  if (stock < quantity) {
    const buttons: InlineKeyboardButton[][] = []
    if (stock > 0) {
      buttons.push([
        {
          text: `🛒 Mua ${stock} sản phẩm còn lại`,
          callback_data: `qty:${categoryId}:${stock}`,
        },
      ])
    }
    buttons.push(buildBackButton(`cat:${categoryId}`))

    await editOrSendMessage(
      botToken,
      chatId,
      messageId,
      `⚠️ Chỉ còn <b>${stock}</b> sản phẩm khả dụng.\n\nBạn yêu cầu ${quantity} nhưng kho không đủ.`,
      {
        parse_mode: 'HTML',
        reply_markup: buildInlineKeyboard(buttons),
      }
    )
    return
  }

  // Show confirmation
  const totalAmount = category.price * quantity
  const text = [
    '🛒 <b>Xác nhận mua hàng</b>',
    '',
    `${category.emoji} ${category.name}`,
    `📦 Số lượng: <b>${quantity}</b>`,
    `💰 Đơn giá: ${formatCurrency(category.price)}`,
    `💵 Tổng tiền: <b>${formatCurrency(totalAmount)}</b>`,
    '',
    'Bấm nút bên dưới để xác nhận mua:',
  ].join('\n')

  const buttons = [
    [{ text: '✅ Xác nhận mua', callback_data: `buy:${categoryId}:${quantity}` }],
    buildBackButton(`cat:${categoryId}`),
  ]

  await editOrSendMessage(botToken, chatId, messageId, text, {
    parse_mode: 'HTML',
    reply_markup: buildInlineKeyboard(buttons),
  })
}

// --- 4. Purchase Confirm ---

/**
 * Thực hiện mua hàng: gọi TransactionService.executePurchase → gửi product contents.
 * Callback: `buy:{catId}:{qty}`
 */
export async function handlePurchaseConfirm(
  db: D1Database,
  botToken: string,
  chatId: number,
  messageId: number | undefined,
  categoryId: number,
  quantity: number,
  userId: number
): Promise<void> {
  // Cooldown chặt cho thao tác đắt + nhạy cảm tài chính: chặn double-tap "Xác nhận mua".
  const verdict = consumeToken(`buy:${userId}`, PURCHASE_RULE)
  if (!verdict.allowed) {
    if (shouldSendNotice(`buy:${userId}`)) {
      await sendMessage(
        botToken,
        chatId,
        `⏳ Bạn vừa thực hiện giao dịch. Vui lòng chờ ${retryAfterSeconds(verdict.retryAfterMs)} giây rồi thử lại.`,
        { parse_mode: 'HTML' }
      )
    }
    return
  }

  // Query user by telegram_id to get internal user.id
  const user = await db
    .prepare('SELECT id, balance FROM users WHERE telegram_id = ?')
    .bind(userId)
    .first<{ id: number; balance: number }>()

  if (!user) {
    await editOrSendMessage(
      botToken,
      chatId,
      messageId,
      '❌ Không tìm thấy tài khoản. Gõ /start để bắt đầu.',
      {
        reply_markup: buildInlineKeyboard([buildBackButton('menu:main')]),
      }
    )
    return
  }

  // Query category for unitPrice
  const category = await db
    .prepare('SELECT * FROM product_types WHERE id = ?')
    .bind(categoryId)
    .first<DbProductType>()

  if (!category) {
    await editOrSendMessage(
      botToken,
      chatId,
      messageId,
      '❌ Không tìm thấy loại sản phẩm.',
      {
        reply_markup: buildInlineKeyboard([buildBackButton('cat:list')]),
      }
    )
    return
  }

  const totalAmount = category.price * quantity

  // Execute purchase
  const result = await transactionService.executePurchase(
    db,
    user.id,
    categoryId,
    quantity,
    category.price
  )

  if (!result.success) {
    if (result.error === 'insufficient_balance') {
      const shortfall = totalAmount - user.balance
      const text = [
        '❌ <b>Số dư không đủ</b>',
        '',
        `💰 Số dư hiện tại: ${formatCurrency(user.balance)}`,
        `💵 Cần thanh toán: ${formatCurrency(totalAmount)}`,
        `📌 Cần nạp thêm: <b>${formatCurrency(shortfall)}</b>`,
      ].join('\n')

      const buttons = [
        [{ text: '💰 Nạp tiền', callback_data: 'dep:menu' }],
        buildBackButton(`cat:${categoryId}`),
      ]

      await editOrSendMessage(botToken, chatId, messageId, text, {
        parse_mode: 'HTML',
        reply_markup: buildInlineKeyboard(buttons),
      })
      return
    }

    if (result.error === 'insufficient_stock') {
      // Check actual remaining stock
      const stockResult = await db
        .prepare(
          `SELECT COUNT(*) as stock FROM products WHERE type_id = ? AND status = 'available'`
        )
        .bind(categoryId)
        .first<{ stock: number }>()

      const remaining = stockResult?.stock ?? 0

      const buttons: InlineKeyboardButton[][] = []
      if (remaining > 0) {
        buttons.push([
          {
            text: `🛒 Mua ${remaining} sản phẩm còn lại`,
            callback_data: `qty:${categoryId}:${remaining}`,
          },
        ])
      }
      buttons.push(buildBackButton(`cat:${categoryId}`))

      await editOrSendMessage(
        botToken,
        chatId,
        messageId,
        `⚠️ Chỉ còn <b>${remaining}</b> sản phẩm khả dụng.\n\nVui lòng chọn số lượng phù hợp.`,
        {
          parse_mode: 'HTML',
          reply_markup: buildInlineKeyboard(buttons),
        }
      )
      return
    }

    // db_error or unknown
    await editOrSendMessage(
      botToken,
      chatId,
      messageId,
      '❌ Đã xảy ra lỗi khi xử lý giao dịch. Vui lòng thử lại sau.',
      {
        reply_markup: buildInlineKeyboard([buildBackButton('menu:main')]),
      }
    )
    return
  }

  // --- Success: send product contents ---
  const products = result.products ?? []
  const balanceAfter = user.balance - totalAmount

  // Render tin nhắn thành công theo template của category (fallback mặc định)
  const contentText = renderSuccessMessage(category.success_template, {
    emoji: category.emoji,
    name: category.name,
    quantity,
    totalAmount,
    balanceAfter,
    contents: products.map((p) => p.content),
  })

  const successButtons = [
    [
      { text: '🛒 Mua thêm', callback_data: 'cat:list' },
      { text: '🔙 Quay lại', callback_data: 'menu:main' },
    ],
  ]

  await editOrSendMessage(botToken, chatId, messageId, contentText, {
    parse_mode: 'HTML',
    reply_markup: buildInlineKeyboard(successButtons),
  })
}

// --- 5. Handle text input for quantity ---

/**
 * Xử lý nhập số lượng tự do qua text message.
 * Gọi từ router khi session flow='purchase' và step='quantity'.
 */
export async function handlePurchaseTextInput(
  db: D1Database,
  botToken: string,
  chatId: number,
  userId: number,
  text: string,
  categoryId: number
): Promise<void> {
  const qty = parseInt(text, 10)

  // Validate: integer, 1-50
  if (isNaN(qty) || !Number.isInteger(qty) || qty <= 0 || qty > MAX_QTY) {
    await sendMessage(
      botToken,
      chatId,
      `⚠️ Số lượng không hợp lệ. Vui lòng nhập số nguyên từ 1 đến ${MAX_QTY}.`
    )
    return
  }

  // Delegate to quantity select handler (confirmation screen)
  await handleQuantitySelect(db, botToken, chatId, undefined, categoryId, qty, userId)
}
