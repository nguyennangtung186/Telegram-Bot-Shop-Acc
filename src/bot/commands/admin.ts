/**
 * Admin Bot Commands — quản lý categories, products, thống kê qua Telegram bot.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */

import {
  sendMessage,
  editOrSendMessage,
  buildInlineKeyboard,
} from '../telegram-api'
import { getSession, setSession, clearSession } from '../session'
import { formatCurrency } from '../../utils/format'

// --- Constants ---

const PAGE_SIZE = 20
const MAX_BULK_PRODUCTS = 50
const MAX_CONTENT_LENGTH = 2000

// --- Validation ---

export interface ValidationResult {
  valid: boolean
  error?: string
}

export function validateName(name: string): ValidationResult {
  const trimmed = name.trim()
  if (!trimmed) return { valid: false, error: '❌ Tên không được để trống.' }
  if (trimmed.length > 100) return { valid: false, error: '❌ Tên tối đa 100 ký tự.' }
  return { valid: true }
}

export function validateDescription(description: string): ValidationResult {
  if (description.length > 500) return { valid: false, error: '❌ Mô tả tối đa 500 ký tự.' }
  return { valid: true }
}

export function validatePrice(input: string): ValidationResult {
  const price = parseInt(input.replace(/[.,\s]/g, ''), 10)
  if (isNaN(price) || !Number.isInteger(price)) {
    return { valid: false, error: '❌ Giá phải là số nguyên.' }
  }
  if (price < 1000) return { valid: false, error: '❌ Giá tối thiểu 1,000đ.' }
  if (price > 999999999) return { valid: false, error: '❌ Giá tối đa 999,999,999đ.' }
  return { valid: true }
}

export function parsePrice(input: string): number {
  return parseInt(input.replace(/[.,\s]/g, ''), 10)
}

// --- 1. Admin Panel ---

/**
 * Hiển thị bảng điều khiển Admin với inline keyboard.
 */
export async function handleAdminPanel(
  db: D1Database,
  botToken: string,
  chatId: number,
  messageId?: number
): Promise<void> {
  const text = '🔧 <b>Bảng điều khiển Admin</b>\n\nChọn chức năng:'

  const keyboard = buildInlineKeyboard([
    [
      { text: '➕ Thêm loại', callback_data: 'adm:addtype' },
      { text: '📋 Danh sách loại', callback_data: 'adm:listtypes' },
    ],
    [
      { text: '➕ Thêm sản phẩm', callback_data: 'adm:addproduct' },
      { text: '📊 Thống kê', callback_data: 'adm:stats' },
    ],
  ])

  await editOrSendMessage(botToken, chatId, messageId, text, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  })
}

// --- 2. Add Type Flow ---

/**
 * Multi-step flow thêm loại sản phẩm: tên → mô tả → giá → tạo.
 */
export async function handleAddTypeFlow(
  db: D1Database,
  botToken: string,
  chatId: number,
  userId: number,
  step: string,
  data?: Record<string, any>
): Promise<void> {
  switch (step) {
    case 'start': {
      setSession(userId, 'admin_add_type', 'name', {})
      await sendMessage(botToken, chatId, '📝 <b>Thêm loại sản phẩm mới</b>\n\nNhập <b>tên loại</b> (1-100 ký tự):\n\n<i>Gửi /cancel để huỷ</i>', {
        parse_mode: 'HTML',
      })
      break
    }

    case 'name': {
      const name = data?.input?.trim() ?? ''
      const validation = validateName(name)
      if (!validation.valid) {
        await sendMessage(botToken, chatId, `${validation.error}\n\nNhập lại <b>tên loại</b>:`, {
          parse_mode: 'HTML',
        })
        return
      }
      setSession(userId, 'admin_add_type', 'description', { name })
      await sendMessage(botToken, chatId, '📝 Nhập <b>mô tả</b> (0-500 ký tự, gửi "." nếu bỏ qua):\n\n<i>Gửi /cancel để huỷ</i>', {
        parse_mode: 'HTML',
      })
      break
    }

    case 'description': {
      const session = getSession(userId)
      let description = data?.input ?? ''
      if (description.trim() === '.') description = ''

      const validation = validateDescription(description)
      if (!validation.valid) {
        await sendMessage(botToken, chatId, `${validation.error}\n\nNhập lại <b>mô tả</b>:`, {
          parse_mode: 'HTML',
        })
        return
      }

      setSession(userId, 'admin_add_type', 'price', {
        ...session?.data,
        description: description.trim(),
      })
      await sendMessage(botToken, chatId, '💰 Nhập <b>giá bán</b> (1,000 - 999,999,999 VNĐ):\n\n<i>Gửi /cancel để huỷ</i>', {
        parse_mode: 'HTML',
      })
      break
    }

    case 'price': {
      const session = getSession(userId)
      const input = data?.input ?? ''
      const validation = validatePrice(input)
      if (!validation.valid) {
        await sendMessage(botToken, chatId, `${validation.error}\n\nNhập lại <b>giá bán</b>:`, {
          parse_mode: 'HTML',
        })
        return
      }

      const price = parsePrice(input)
      const name = session?.data?.name ?? ''
      const description = session?.data?.description ?? ''

      // Insert vào DB
      const now = new Date().toISOString()
      await db.prepare(
        'INSERT INTO product_types (name, description, price, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(name, description || null, price, now, now).run()

      clearSession(userId)

      const confirmText = `✅ <b>Đã tạo loại sản phẩm mới!</b>\n\n📦 Tên: ${name}\n📝 Mô tả: ${description || '(không có)'}\n💰 Giá: ${formatCurrency(price)}`

      const keyboard = buildInlineKeyboard([
        [{ text: '🔙 Bảng điều khiển', callback_data: 'adm:panel' }],
      ])

      await sendMessage(botToken, chatId, confirmText, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      })
      break
    }
  }
}

// --- 3. List Types (paginated) ---

/**
 * Hiển thị danh sách categories, phân trang 20 items.
 */
export async function handleListTypes(
  db: D1Database,
  botToken: string,
  chatId: number,
  messageId: number | undefined,
  page: number = 0
): Promise<void> {
  const offset = page * PAGE_SIZE

  // Count total
  const countResult = await db.prepare('SELECT COUNT(*) as total FROM product_types').first<{ total: number }>()
  const total = countResult?.total ?? 0

  if (total === 0) {
    const keyboard = buildInlineKeyboard([
      [{ text: '🔙 Bảng điều khiển', callback_data: 'adm:panel' }],
    ])
    await editOrSendMessage(botToken, chatId, messageId, '📋 Chưa có loại sản phẩm nào.', {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    })
    return
  }

  // Get categories with stock info
  const categories = await db.prepare(`
    SELECT pt.*,
      (SELECT COUNT(*) FROM products WHERE type_id = pt.id AND status = 'available') as stock_available,
      (SELECT COUNT(*) FROM products WHERE type_id = pt.id) as stock_total
    FROM product_types pt
    ORDER BY pt.sort_order ASC, pt.id ASC
    LIMIT ? OFFSET ?
  `).bind(PAGE_SIZE, offset).all()

  const totalPages = Math.ceil(total / PAGE_SIZE)

  let text = `📋 <b>Danh sách loại sản phẩm</b> (trang ${page + 1}/${totalPages})\n\n`

  const buttons: Array<Array<{ text: string; callback_data: string }>> = []

  for (const cat of categories.results) {
    const c = cat as any
    text += `${c.emoji || '📦'} <b>${c.name}</b> — ${formatCurrency(c.price)} (${c.stock_available}/${c.stock_total})\n`

    buttons.push([
      { text: `✏️ ${c.name}`, callback_data: `adm:edit:${c.id}` },
      { text: `🗑️ Xoá`, callback_data: `adm:del:${c.id}` },
    ])
  }

  // Pagination buttons
  const navButtons: Array<{ text: string; callback_data: string }> = []
  if (page > 0) {
    navButtons.push({ text: '⬅️ Trước', callback_data: `adm:listtypes:${page - 1}` })
  }
  if (page < totalPages - 1) {
    navButtons.push({ text: '➡️ Sau', callback_data: `adm:listtypes:${page + 1}` })
  }
  if (navButtons.length > 0) {
    buttons.push(navButtons)
  }

  buttons.push([{ text: '🔙 Bảng điều khiển', callback_data: 'adm:panel' }])

  const keyboard = buildInlineKeyboard(buttons)

  await editOrSendMessage(botToken, chatId, messageId, text, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  })
}

// --- 4. Edit Type Flow ---

/**
 * Multi-step flow sửa loại sản phẩm.
 */
export async function handleEditType(
  db: D1Database,
  botToken: string,
  chatId: number,
  userId: number,
  typeId: number,
  step: string,
  value?: string
): Promise<void> {
  switch (step) {
    case 'start': {
      const category = await db.prepare('SELECT * FROM product_types WHERE id = ?').bind(typeId).first()
      if (!category) {
        await sendMessage(botToken, chatId, '❌ Loại sản phẩm không tồn tại.')
        return
      }

      const c = category as any
      setSession(userId, 'admin_edit_type', 'name', { typeId, name: c.name, description: c.description ?? '', price: c.price })

      const text = `✏️ <b>Sửa loại sản phẩm</b>\n\n📦 Tên: ${c.name}\n📝 Mô tả: ${c.description || '(không có)'}\n💰 Giá: ${formatCurrency(c.price)}\n\nNhập <b>tên mới</b> (gửi "." để giữ nguyên):\n\n<i>Gửi /cancel để huỷ</i>`

      await sendMessage(botToken, chatId, text, { parse_mode: 'HTML' })
      break
    }

    case 'name': {
      const session = getSession(userId)
      if (!session) return

      const input = value?.trim() ?? ''
      if (input !== '.') {
        const validation = validateName(input)
        if (!validation.valid) {
          await sendMessage(botToken, chatId, `${validation.error}\n\nNhập lại <b>tên mới</b> (hoặc "." để giữ nguyên):`, {
            parse_mode: 'HTML',
          })
          return
        }
        session.data.name = input
      }

      setSession(userId, 'admin_edit_type', 'description', session.data)
      await sendMessage(botToken, chatId, `📝 Nhập <b>mô tả mới</b> (gửi "." để giữ nguyên, "-" để xoá):\n\n<i>Gửi /cancel để huỷ</i>`, {
        parse_mode: 'HTML',
      })
      break
    }

    case 'description': {
      const session = getSession(userId)
      if (!session) return

      const input = value ?? ''
      if (input.trim() === '-') {
        session.data.description = ''
      } else if (input.trim() !== '.') {
        const validation = validateDescription(input)
        if (!validation.valid) {
          await sendMessage(botToken, chatId, `${validation.error}\n\nNhập lại <b>mô tả mới</b>:`, {
            parse_mode: 'HTML',
          })
          return
        }
        session.data.description = input.trim()
      }

      setSession(userId, 'admin_edit_type', 'price', session.data)
      await sendMessage(botToken, chatId, `💰 Nhập <b>giá mới</b> (gửi "." để giữ nguyên):\n\n<i>Gửi /cancel để huỷ</i>`, {
        parse_mode: 'HTML',
      })
      break
    }

    case 'price': {
      const session = getSession(userId)
      if (!session) return

      const input = value?.trim() ?? ''
      if (input !== '.') {
        const validation = validatePrice(input)
        if (!validation.valid) {
          await sendMessage(botToken, chatId, `${validation.error}\n\nNhập lại <b>giá mới</b> (hoặc "." để giữ nguyên):`, {
            parse_mode: 'HTML',
          })
          return
        }
        session.data.price = parsePrice(input)
      }

      // Update DB
      const { typeId: id, name, description, price } = session.data
      const now = new Date().toISOString()
      await db.prepare(
        'UPDATE product_types SET name = ?, description = ?, price = ?, updated_at = ? WHERE id = ?'
      ).bind(name, description || null, price, now, id).run()

      clearSession(userId)

      const confirmText = `✅ <b>Đã cập nhật loại sản phẩm!</b>\n\n📦 Tên: ${name}\n📝 Mô tả: ${description || '(không có)'}\n💰 Giá: ${formatCurrency(price)}`

      const keyboard = buildInlineKeyboard([
        [{ text: '📋 Danh sách loại', callback_data: 'adm:listtypes' }],
        [{ text: '🔙 Bảng điều khiển', callback_data: 'adm:panel' }],
      ])

      await sendMessage(botToken, chatId, confirmText, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      })
      break
    }
  }
}

// --- 5. Delete Type ---

/**
 * Xoá loại sản phẩm — check available products, xác nhận.
 */
export async function handleDeleteType(
  db: D1Database,
  botToken: string,
  chatId: number,
  messageId: number | undefined,
  typeId: number
): Promise<void> {
  const category = await db.prepare('SELECT * FROM product_types WHERE id = ?').bind(typeId).first()
  if (!category) {
    await editOrSendMessage(botToken, chatId, messageId, '❌ Loại sản phẩm không tồn tại.', {
      parse_mode: 'HTML',
    })
    return
  }

  const c = category as any
  const availableCount = await db.prepare(
    "SELECT COUNT(*) as count FROM products WHERE type_id = ? AND status = 'available'"
  ).bind(typeId).first<{ count: number }>()

  const available = availableCount?.count ?? 0

  if (available > 0) {
    const text = `⚠️ <b>Không thể xoá!</b>\n\n📦 <b>${c.name}</b> còn <b>${available}</b> sản phẩm khả dụng.\n\nVui lòng xoá hết sản phẩm trước khi xoá loại.`
    const keyboard = buildInlineKeyboard([
      [{ text: '📋 Danh sách loại', callback_data: 'adm:listtypes' }],
    ])
    await editOrSendMessage(botToken, chatId, messageId, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    })
    return
  }

  const text = `🗑️ <b>Xác nhận xoá?</b>\n\n📦 Tên: ${c.name}\n💰 Giá: ${formatCurrency(c.price)}\n\n⚠️ Thao tác này không thể hoàn tác.`

  const keyboard = buildInlineKeyboard([
    [
      { text: '✅ Xác nhận xoá', callback_data: `adm:delconfirm:${typeId}` },
      { text: '❌ Huỷ', callback_data: 'adm:listtypes' },
    ],
  ])

  await editOrSendMessage(botToken, chatId, messageId, text, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  })
}

/**
 * Xác nhận xoá loại sản phẩm (sau khi user bấm confirm).
 */
export async function handleDeleteTypeConfirm(
  db: D1Database,
  botToken: string,
  chatId: number,
  messageId: number | undefined,
  typeId: number
): Promise<void> {
  // Double-check available products
  const availableCount = await db.prepare(
    "SELECT COUNT(*) as count FROM products WHERE type_id = ? AND status = 'available'"
  ).bind(typeId).first<{ count: number }>()

  if ((availableCount?.count ?? 0) > 0) {
    await editOrSendMessage(botToken, chatId, messageId, '⚠️ Không thể xoá — vẫn còn sản phẩm khả dụng.', {
      parse_mode: 'HTML',
      reply_markup: buildInlineKeyboard([
        [{ text: '📋 Danh sách loại', callback_data: 'adm:listtypes' }],
      ]),
    })
    return
  }

  await db.prepare('DELETE FROM product_types WHERE id = ?').bind(typeId).run()

  const keyboard = buildInlineKeyboard([
    [{ text: '📋 Danh sách loại', callback_data: 'adm:listtypes' }],
    [{ text: '🔙 Bảng điều khiển', callback_data: 'adm:panel' }],
  ])

  await editOrSendMessage(botToken, chatId, messageId, '✅ Đã xoá loại sản phẩm thành công.', {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  })
}

// --- 6. Add Product Flow ---

/**
 * Multi-step flow thêm sản phẩm: chọn category → nhập content (bulk).
 */
export async function handleAddProduct(
  db: D1Database,
  botToken: string,
  chatId: number,
  userId: number,
  step: string,
  data?: Record<string, any>
): Promise<void> {
  switch (step) {
    case 'start': {
      // Hiển thị danh sách categories để chọn
      const categories = await db.prepare(
        'SELECT id, name, emoji, price FROM product_types ORDER BY sort_order ASC, id ASC'
      ).all()

      if (!categories.results.length) {
        const keyboard = buildInlineKeyboard([
          [{ text: '🔙 Bảng điều khiển', callback_data: 'adm:panel' }],
        ])
        await sendMessage(botToken, chatId, '📋 Chưa có loại sản phẩm. Vui lòng tạo loại trước.', {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        })
        return
      }

      const buttons = categories.results.map((cat: any) => [
        { text: `${cat.emoji || '📦'} ${cat.name} — ${formatCurrency(cat.price)}`, callback_data: `adm:addprod:${cat.id}` },
      ])
      buttons.push([{ text: '🔙 Bảng điều khiển', callback_data: 'adm:panel' }])

      const keyboard = buildInlineKeyboard(buttons)
      await sendMessage(botToken, chatId, '📦 <b>Thêm sản phẩm</b>\n\nChọn loại sản phẩm:', {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      })
      break
    }

    case 'category': {
      const categoryId = data?.categoryId
      if (!categoryId) return

      const category = await db.prepare('SELECT * FROM product_types WHERE id = ?').bind(categoryId).first()
      if (!category) {
        await sendMessage(botToken, chatId, '❌ Loại sản phẩm không tồn tại.')
        return
      }

      const c = category as any
      setSession(userId, 'admin_add_product', 'content', { categoryId, categoryName: c.name })

      const text = `📦 <b>Thêm sản phẩm vào: ${c.name}</b>\n\nNhập nội dung sản phẩm (mỗi dòng 1 sản phẩm, tối đa ${MAX_BULK_PRODUCTS} sản phẩm):\n\n<i>Gửi /cancel để huỷ</i>`
      await sendMessage(botToken, chatId, text, { parse_mode: 'HTML' })
      break
    }

    case 'content': {
      const session = getSession(userId)
      if (!session) return

      const input = data?.input ?? ''
      const categoryId = session.data.categoryId
      const categoryName = session.data.categoryName

      // Parse lines
      const lines = input
        .split('\n')
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 0)

      if (lines.length === 0) {
        await sendMessage(botToken, chatId, '❌ Nội dung không được trống. Nhập lại:', { parse_mode: 'HTML' })
        return
      }

      if (lines.length > MAX_BULK_PRODUCTS) {
        await sendMessage(botToken, chatId, `❌ Tối đa ${MAX_BULK_PRODUCTS} sản phẩm mỗi lần. Bạn nhập ${lines.length} dòng.`, {
          parse_mode: 'HTML',
        })
        return
      }

      // Validate content length
      const invalidLines: string[] = []
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].length > MAX_CONTENT_LENGTH) {
          invalidLines.push(`Dòng ${i + 1}: vượt ${MAX_CONTENT_LENGTH} ký tự`)
        }
      }
      if (invalidLines.length > 0) {
        await sendMessage(botToken, chatId, `❌ Lỗi:\n${invalidLines.join('\n')}\n\nNhập lại:`, {
          parse_mode: 'HTML',
        })
        return
      }

      // Check duplicates within input
      const inputDups = lines.filter((item: string, index: number) => lines.indexOf(item) !== index)
      if (inputDups.length > 0) {
        const uniqueDups = [...new Set(inputDups)]
        await sendMessage(botToken, chatId, `❌ Nội dung trùng trong danh sách nhập:\n${uniqueDups.slice(0, 5).join('\n')}\n\nNhập lại:`, {
          parse_mode: 'HTML',
        })
        return
      }

      // Check duplicates in DB per category
      const existingDups: string[] = []
      for (const content of lines) {
        const exists = await db.prepare(
          'SELECT id FROM products WHERE type_id = ? AND content = ?'
        ).bind(categoryId, content).first()
        if (exists) {
          existingDups.push(content)
        }
      }

      if (existingDups.length > 0) {
        await sendMessage(
          botToken,
          chatId,
          `❌ Nội dung đã tồn tại trong loại "${categoryName}":\n${existingDups.slice(0, 5).map(d => `• ${d.substring(0, 50)}...`).join('\n')}${existingDups.length > 5 ? `\n... và ${existingDups.length - 5} mục khác` : ''}\n\nNhập lại (bỏ các mục trùng):`,
          { parse_mode: 'HTML' }
        )
        return
      }

      // Batch insert
      const now = new Date().toISOString()
      const stmts = lines.map((content: string) =>
        db.prepare(
          'INSERT INTO products (type_id, content, status, created_at) VALUES (?, ?, ?, ?)'
        ).bind(categoryId, content, 'available', now)
      )

      await db.batch(stmts)

      clearSession(userId)

      const keyboard = buildInlineKeyboard([
        [{ text: '➕ Thêm tiếp', callback_data: `adm:addprod:${categoryId}` }],
        [{ text: '🔙 Bảng điều khiển', callback_data: 'adm:panel' }],
      ])

      await sendMessage(
        botToken,
        chatId,
        `✅ <b>Đã thêm ${lines.length} sản phẩm</b> vào loại "${categoryName}".`,
        { parse_mode: 'HTML', reply_markup: keyboard }
      )
      break
    }
  }
}

// --- 7. Stats ---

/**
 * Hiển thị thống kê tổng quan.
 */
export async function handleStats(
  db: D1Database,
  botToken: string,
  chatId: number,
  messageId: number | undefined
): Promise<void> {
  // Total users
  const usersResult = await db.prepare('SELECT COUNT(*) as total FROM users').first<{ total: number }>()
  const totalUsers = usersResult?.total ?? 0

  // Total revenue (sum of purchase transactions, amount is negative for purchases)
  const revenueResult = await db.prepare(
    "SELECT COALESCE(SUM(ABS(amount)), 0) as total FROM transactions WHERE type = 'purchase' AND status = 'success'"
  ).first<{ total: number }>()
  const totalRevenue = revenueResult?.total ?? 0

  // Products per category
  const categoryStats = await db.prepare(`
    SELECT 
      pt.name,
      pt.emoji,
      COALESCE(SUM(CASE WHEN p.status = 'sold' THEN 1 ELSE 0 END), 0) as sold,
      COALESCE(SUM(CASE WHEN p.status = 'available' THEN 1 ELSE 0 END), 0) as available
    FROM product_types pt
    LEFT JOIN products p ON p.type_id = pt.id
    GROUP BY pt.id
    ORDER BY pt.sort_order ASC, pt.id ASC
  `).all()

  let text = '📊 <b>Thống kê hệ thống</b>\n\n'
  text += `👥 Tổng user: <b>${totalUsers}</b>\n`
  text += `💰 Tổng doanh thu: <b>${formatCurrency(totalRevenue)}</b>\n\n`

  if (categoryStats.results.length > 0) {
    text += '📦 <b>Sản phẩm theo loại:</b>\n'
    for (const stat of categoryStats.results) {
      const s = stat as any
      text += `${s.emoji || '📦'} ${s.name}: ✅ ${s.sold} đã bán / 📦 ${s.available} còn lại\n`
    }
  } else {
    text += '📦 Chưa có loại sản phẩm nào.\n'
  }

  const keyboard = buildInlineKeyboard([
    [{ text: '🔙 Bảng điều khiển', callback_data: 'adm:panel' }],
  ])

  await editOrSendMessage(botToken, chatId, messageId, text, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  })
}

// --- Admin Callback Router ---

/**
 * Route admin callback queries dựa trên params.
 */
export async function handleAdminCallbackRouted(
  db: D1Database,
  botToken: string,
  chatId: number,
  messageId: number | undefined,
  userId: number,
  params: string[]
): Promise<void> {
  const subAction = params[0] ?? 'panel'

  switch (subAction) {
    case 'panel':
      await handleAdminPanel(db, botToken, chatId, messageId)
      break

    case 'addtype':
      await handleAddTypeFlow(db, botToken, chatId, userId, 'start')
      break

    case 'listtypes': {
      const page = params[1] ? parseInt(params[1], 10) : 0
      await handleListTypes(db, botToken, chatId, messageId, page)
      break
    }

    case 'edit': {
      const typeId = parseInt(params[1], 10)
      if (isNaN(typeId)) return
      await handleEditType(db, botToken, chatId, userId, typeId, 'start')
      break
    }

    case 'del': {
      const typeId = parseInt(params[1], 10)
      if (isNaN(typeId)) return
      await handleDeleteType(db, botToken, chatId, messageId, typeId)
      break
    }

    case 'delconfirm': {
      const typeId = parseInt(params[1], 10)
      if (isNaN(typeId)) return
      await handleDeleteTypeConfirm(db, botToken, chatId, messageId, typeId)
      break
    }

    case 'addproduct':
      await handleAddProduct(db, botToken, chatId, userId, 'start')
      break

    case 'addprod': {
      const categoryId = parseInt(params[1], 10)
      if (isNaN(categoryId)) return
      await handleAddProduct(db, botToken, chatId, userId, 'category', { categoryId })
      break
    }

    case 'stats':
      await handleStats(db, botToken, chatId, messageId)
      break

    default:
      await handleAdminPanel(db, botToken, chatId, messageId)
      break
  }
}

// --- Admin Text Input Handler ---

/**
 * Xử lý text input cho admin multi-step flows.
 */
export async function handleAdminTextInputRouted(
  db: D1Database,
  botToken: string,
  chatId: number,
  userId: number,
  text: string,
  flow: string,
  step: string | null
): Promise<void> {
  switch (flow) {
    case 'admin_add_type':
      await handleAddTypeFlow(db, botToken, chatId, userId, step ?? 'name', { input: text })
      break

    case 'admin_edit_type': {
      const session = getSession(userId)
      if (!session) return
      const typeId = session.data.typeId
      await handleEditType(db, botToken, chatId, userId, typeId, step ?? 'name', text)
      break
    }

    case 'admin_add_product':
      await handleAddProduct(db, botToken, chatId, userId, step ?? 'content', { input: text })
      break
  }
}
