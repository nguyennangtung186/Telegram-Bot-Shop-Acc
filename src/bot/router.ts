/**
 * Callback Query Router & Text Message Router.
 * Parse callback_data format "action:param1:param2", dispatch tới handler tương ứng.
 * Xử lý text messages: detect flow context (session), route input text tương ứng.
 * Requirements: 7.4, 7.8
 */

import type { CallbackQuery, Message } from '../types/telegram'
import type { Bindings } from '../types/bindings'
import {
  answerCallbackQuery,
  sendMessage,
  buildMainMenu,
  buildInlineKeyboard,
  editOrSendMessage,
} from './telegram-api'
import { getSession, clearSession } from './session'
import { handleStart } from './commands/start'
import { handleBotError } from '../utils/error-handler'
import { isAdmin } from '../utils/admin'
import { handleAdminCallbackRouted, handleAdminTextInputRouted, handleAdminPanel } from './commands/admin'
import {
  handleCategoryList,
  handleCategoryDetail,
  handleQuantitySelect,
  handlePurchaseConfirm,
  handlePurchaseTextInput,
} from './callbacks/purchase'
import { handleHistory } from './callbacks/history'
import { handleAccount } from './callbacks/account'
import {
  handleDepositMenu,
  handleDepositAmount,
  handleDepositCancel,
} from './callbacks/deposit'

// --- Types ---

export interface ParsedCallback {
  action: string
  params: string[]
}

// --- Helper: parse callback_data ---

/**
 * Parse callback_data string → action + params.
 * Format: "action:param1:param2:..."
 */
export function parseCallbackData(data: string): ParsedCallback {
  const parts = data.split(':')
  const action = parts[0] ?? ''
  const params = parts.slice(1)
  return { action, params }
}

// --- Deposit callback dispatcher ---

async function handleDepositCallback(
  db: D1Database,
  botToken: string,
  chatId: number,
  messageId: number | undefined,
  params: string[],
  userId: number,
  env: Bindings
): Promise<void> {
  const subAction = params[0]

  if (subAction === 'menu' || !subAction) {
    await handleDepositMenu(db, botToken, chatId, userId, messageId)
    return
  }

  if (subAction === 'cancel') {
    await handleDepositCancel(db, botToken, chatId, userId, messageId)
    return
  }

  // subAction is an amount (e.g., "50000")
  const amount = parseInt(subAction, 10)
  if (!isNaN(amount)) {
    await handleDepositAmount(db, botToken, chatId, userId, amount, env)
    return
  }

  // Unknown deposit sub-action
  await handleDepositMenu(db, botToken, chatId, userId, messageId)
}

// --- Admin callback dispatcher ---

async function handleAdminCallback(
  db: D1Database,
  botToken: string,
  chatId: number,
  messageId: number | undefined,
  params: string[],
  userId: number,
  env: Bindings
): Promise<void> {
  if (!isAdmin(userId, env.ADMIN_IDS)) {
    await editOrSendMessage(botToken, chatId, messageId, '⛔ Bạn không có quyền truy cập.', {
      parse_mode: 'HTML',
    })
    return
  }
  await handleAdminCallbackRouted(db, env.BOT_TOKEN, chatId, messageId, userId, params)
}

// --- Main Callback Query Handler ---

/**
 * Dispatch callback query tới handler tương ứng dựa trên action prefix.
 */
export async function handleCallbackQuery(
  db: D1Database,
  botToken: string,
  callbackQuery: CallbackQuery,
  env: Bindings
): Promise<void> {
  const chatId = callbackQuery.message?.chat.id
  const messageId = callbackQuery.message?.message_id
  const userId = callbackQuery.from.id
  const data = callbackQuery.data

  if (!chatId) return

  try {
    // Answer callback query ngay lập tức (dismiss loading indicator)
    await answerCallbackQuery(botToken, callbackQuery.id)

    // Nếu không có data → invalid callback
    if (!data) {
      await sendMessage(botToken, chatId, '⚠️ Yêu cầu không hợp lệ.', {
        reply_markup: buildMainMenu(),
      })
      return
    }

    const { action, params } = parseCallbackData(data)

    switch (action) {
      case 'cat':
        if (params[0] === 'list') {
          await handleCategoryList(db, botToken, chatId, messageId)
        } else {
          const catId = parseInt(params[0], 10)
          if (!isNaN(catId)) {
            await handleCategoryDetail(db, botToken, chatId, messageId, catId, userId)
          }
        }
        break

      case 'qty': {
        const catId = parseInt(params[0], 10)
        const qty = parseInt(params[1], 10)
        if (!isNaN(catId) && !isNaN(qty)) {
          await handleQuantitySelect(db, botToken, chatId, messageId, catId, qty, userId)
        }
        break
      }

      case 'buy': {
        const catId = parseInt(params[0], 10)
        const qty = parseInt(params[1], 10)
        if (!isNaN(catId) && !isNaN(qty)) {
          await handlePurchaseConfirm(db, botToken, chatId, messageId, catId, qty, userId)
        }
        break
      }

      case 'dep':
        await handleDepositCallback(db, botToken, chatId, messageId, params, userId, env)
        break

      case 'page':
        // page:cat:{pageNum} — pagination for category list
        if (params[0] === 'cat') {
          const pageNum = parseInt(params[1], 10)
          await handleCategoryList(db, botToken, chatId, messageId, isNaN(pageNum) ? 0 : pageNum)
        }
        break

      case 'menu':
        // menu:main → hiển thị menu chính với inline shortcuts
        await sendMessage(botToken, chatId, '🏪 <b>Menu chính</b>', {
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
        break

      case 'adm':
        await handleAdminCallback(db, botToken, chatId, messageId, params, userId, env)
        break

      case 'hist':
        await handleHistory(db, botToken, chatId, messageId, userId)
        break

      case 'acc':
        await handleAccount(db, botToken, chatId, messageId, userId)
        break

      default:
        // Unknown action → thông báo lỗi + menu chính
        await sendMessage(botToken, chatId, '⚠️ Yêu cầu không hợp lệ hoặc đã hết hạn.', {
          reply_markup: buildMainMenu(),
        })
        break
    }
  } catch (error) {
    const { message, shouldNotifyUser } = handleBotError(error, {
      userId,
      command: `callback:${data}`,
      operation: 'handleCallbackQuery',
    })

    if (shouldNotifyUser && chatId) {
      try {
        await sendMessage(botToken, chatId, message, {
          reply_markup: buildMainMenu(),
        })
      } catch {
        // Silent fail — đã log ở trên
      }
    }
  }
}

// --- Text Message Handler ---

/**
 * Dispatch text message: reply keyboard buttons → commands → session flows → fallback.
 */
export async function handleTextMessage(
  db: D1Database,
  botToken: string,
  message: Message,
  env: Bindings
): Promise<void> {
  const chatId = message.chat.id
  const from = message.from
  const text = message.text?.trim() ?? ''
  const userId = from?.id

  if (!userId || !from) return

  try {
    // 1. Reply keyboard buttons
    switch (text) {
      case '🛒 Mua hàng':
        await handleCategoryList(db, botToken, chatId, undefined)
        return

      case '💰 Nạp tiền':
        await handleDepositMenu(db, botToken, chatId, userId, undefined)
        return

      case '📜 Lịch sử':
        await handleHistory(db, botToken, chatId, undefined, userId)
        return

      case '👤 Số dư':
        await handleAccount(db, botToken, chatId, undefined, userId)
        return
    }

    // 2. Commands
    if (text === '/start') {
      await handleStart(db, botToken, chatId, from)
      return
    }

    if (text === '/admin') {
      if (!isAdmin(userId, env.ADMIN_IDS)) {
        await sendMessage(botToken, chatId, '⛔ Bạn không có quyền truy cập chức năng này.')
        return
      }
      await handleAdminPanel(db, env.BOT_TOKEN, chatId)
      return
    }

    if (text === '/huy' || text === '/cancel') {
      const session = getSession(userId)
      if (session && session.flow === 'deposit') {
        // Cancel pending deposit in DB + clear session
        await handleDepositCancel(db, botToken, chatId, userId, undefined)
        return
      }
      if (session) {
        clearSession(userId)
        await sendMessage(botToken, chatId, '✅ Đã huỷ thao tác hiện tại.', {
          reply_markup: buildMainMenu(),
        })
      } else {
        // Even without session, try to cancel any pending deposit
        await handleDepositCancel(db, botToken, chatId, userId, undefined)
      }
      return
    }

    // 3. Check active session — route input text theo flow context
    const session = getSession(userId)
    if (session && session.flow) {
      await handleSessionInput(db, botToken, chatId, userId, text, session.flow, session.step, env)
      return
    }

    // 4. Fallback — lệnh không hợp lệ
    await sendMessage(botToken, chatId, '❓ Lệnh không hợp lệ. Vui lòng chọn chức năng từ menu bên dưới.', {
      reply_markup: buildMainMenu(),
    })
  } catch (error) {
    const { message: errorMsg, shouldNotifyUser } = handleBotError(error, {
      userId,
      command: text,
      operation: 'handleTextMessage',
    })

    if (shouldNotifyUser) {
      try {
        await sendMessage(botToken, chatId, errorMsg, {
          reply_markup: buildMainMenu(),
        })
      } catch {
        // Silent fail — đã log ở trên
      }
    }
  }
}

// --- Session Input Router ---

/**
 * Route text input dựa trên session flow và step hiện tại.
 * Mỗi flow handler sẽ xử lý validation và next step riêng.
 */
async function handleSessionInput(
  db: D1Database,
  botToken: string,
  chatId: number,
  userId: number,
  text: string,
  flow: string,
  step: string | null,
  env: Bindings
): Promise<void> {
  switch (flow) {
    case 'deposit':
      // User nhập số tiền nạp tùy ý
      await handleDepositTextInput(db, botToken, chatId, userId, text, step, env)
      break

    case 'purchase':
      // User nhập số lượng mua tự do
      await handlePurchaseSessionInput(db, botToken, chatId, userId, text, step)
      break

    case 'admin_add_type':
    case 'admin_edit_type':
    case 'admin_add_product':
      // Admin multi-step flows
      await handleAdminTextInput(db, botToken, chatId, userId, text, flow, step, env)
      break

    default:
      // Flow không xác định → clear session, fallback menu
      clearSession(userId)
      await sendMessage(botToken, chatId, '❓ Phiên làm việc đã hết hạn. Vui lòng bắt đầu lại.', {
        reply_markup: buildMainMenu(),
      })
      break
  }
}

// --- Session text input handlers ---

async function handlePurchaseSessionInput(
  db: D1Database,
  botToken: string,
  chatId: number,
  userId: number,
  text: string,
  step: string | null
): Promise<void> {
  if (step === 'quantity') {
    const session = getSession(userId)
    const categoryId = session?.data?.categoryId
    if (!categoryId) {
      clearSession(userId)
      await sendMessage(botToken, chatId, '❓ Phiên làm việc đã hết hạn. Vui lòng bắt đầu lại.', {
        reply_markup: buildMainMenu(),
      })
      return
    }
    await handlePurchaseTextInput(db, botToken, chatId, userId, text, categoryId)
  } else {
    clearSession(userId)
    await sendMessage(botToken, chatId, '❓ Phiên làm việc đã hết hạn. Vui lòng bắt đầu lại.', {
      reply_markup: buildMainMenu(),
    })
  }
}

async function handleDepositTextInput(
  db: D1Database,
  botToken: string,
  chatId: number,
  userId: number,
  text: string,
  step: string | null,
  env: Bindings
): Promise<void> {
  if (step === 'amount') {
    // Parse amount from text input
    const amount = parseInt(text.replace(/[.,\s]/g, ''), 10)
    if (isNaN(amount)) {
      await sendMessage(botToken, chatId, '⚠️ Vui lòng nhập số tiền hợp lệ (VD: 50000).', {
        parse_mode: 'HTML',
      })
      return
    }
    await handleDepositAmount(db, botToken, chatId, userId, amount, env)
  } else {
    clearSession(userId)
    await sendMessage(botToken, chatId, '❓ Phiên làm việc đã hết hạn. Vui lòng bắt đầu lại.', {
      reply_markup: buildMainMenu(),
    })
  }
}

async function handleAdminTextInput(
  db: D1Database,
  botToken: string,
  chatId: number,
  userId: number,
  text: string,
  flow: string,
  step: string | null,
  env: Bindings
): Promise<void> {
  if (!isAdmin(userId, env.ADMIN_IDS)) {
    clearSession(userId)
    await sendMessage(botToken, chatId, '⛔ Bạn không có quyền truy cập.')
    return
  }
  await handleAdminTextInputRouted(db, botToken, chatId, userId, text, flow, step)
}
