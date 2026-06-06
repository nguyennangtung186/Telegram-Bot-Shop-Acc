/**
 * Render tin nhắn "Mua hàng thành công" cho từng product_type.
 *
 * Cấu trúc tin nhắn = HEADER cố định + BODY.
 *  - HEADER (luôn có, không sửa): ✅ Mua hàng thành công + emoji name × qty + 📋 Nội dung sản phẩm:
 *  - BODY = success_template của product_type. Trống → dùng body mặc định.
 *
 * Placeholder dùng trong BODY (admin nhập ở CMS):
 *   [content]   → danh sách account đã mua (đánh số, mỗi dòng bọc <code>)
 *   [name]      → tên loại sản phẩm
 *   [emoji]     → emoji loại sản phẩm
 *   [quantity]  → số lượng mua
 *   [total]     → tổng tiền (đã format, vd 75,000đ)
 *   [balance]   → số dư còn lại (đã format)
 *
 * BODY là HTML do admin kiểm soát → KHÔNG escape phần template.
 * Giá trị động (account content, name) ĐƯỢC escape để không phá vỡ HTML.
 */

import { formatCurrency } from './format'

export interface SuccessTemplateVars {
  emoji: string
  name: string
  quantity: number
  totalAmount: number
  balanceAfter: number
  contents: string[]
}

/** Các placeholder được hỗ trợ — dùng để hint ở CMS. */
export const TEMPLATE_PLACEHOLDERS = [
  '[content]',
  '[name]',
  '[emoji]',
  '[quantity]',
  '[total]',
  '[balance]',
] as const

/** Escape các ký tự đặc biệt của Telegram HTML (&, <, >). */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Build danh sách account đánh số, mỗi account bọc <code> (đã escape). */
function buildContentList(contents: string[]): string {
  return contents
    .map((c, i) => `${i + 1}. <code>${escapeHtml(c)}</code>`)
    .join('\n')
}

/** Header cố định — luôn xuất hiện ở đầu mọi tin nhắn thành công. */
function buildHeader(vars: SuccessTemplateVars): string {
  return [
    '✅ <b>Mua hàng thành công!</b>',
    '',
    `${vars.emoji} ${escapeHtml(vars.name)} × ${vars.quantity}`,
    '',
    '📋 <b>Nội dung sản phẩm:</b>',
  ].join('\n')
}

/** Body mặc định khi product_type không cấu hình success_template riêng. */
function defaultBody(vars: SuccessTemplateVars): string {
  return [
    buildContentList(vars.contents),
    '',
    '━━━━━━━━━━━━━━━',
    `💵 Tổng tiền: ${formatCurrency(vars.totalAmount)}`,
    `💰 Số dư còn lại: ${formatCurrency(vars.balanceAfter)}`,
  ].join('\n')
}

/** Thay placeholder trong body custom bằng giá trị thật. */
function renderBody(template: string, vars: SuccessTemplateVars): string {
  const replacements: Record<string, string> = {
    '[content]': buildContentList(vars.contents),
    '[name]': escapeHtml(vars.name),
    '[emoji]': vars.emoji,
    '[quantity]': String(vars.quantity),
    '[total]': formatCurrency(vars.totalAmount),
    '[balance]': formatCurrency(vars.balanceAfter),
  }
  return template.replace(
    /\[(content|name|emoji|quantity|total|balance)\]/g,
    (match) => replacements[match] ?? match
  )
}

/**
 * Render tin nhắn thành công đầy đủ: HEADER + BODY.
 * @param template - success_template của product_type (null/empty → body mặc định)
 * @param vars - dữ liệu thay thế
 */
export function renderSuccessMessage(
  template: string | null | undefined,
  vars: SuccessTemplateVars
): string {
  const header = buildHeader(vars)
  const tpl = template?.trim()
  const body = tpl ? renderBody(tpl, vars) : defaultBody(vars)
  return `${header}\n${body}`
}
