/**
 * stores/user.ts — trạng thái người mua (singleton reactive, không cần Pinia).
 *
 * Giữ thông tin định danh + số dư của Buyer, nạp từ `GET /api/app/me`. Số dư được
 * cập nhật ngay sau khi mua (`PurchaseResultDto.new_balance`) hoặc khi poll nạp tiền
 * chuyển sang `completed` (`DepositStatusDto.new_balance`).
 *
 * Stateless theo Req 1.7: KHÔNG persist gì ra localStorage — state chỉ sống trong phiên
 * WebApp; mỗi lần mở lại app sẽ `fetchMe()` mới.
 */

import { reactive, readonly, type DeepReadonly } from 'vue'
import { get } from '@/api/client'
import { formatCurrency } from '@/utils/format'
import type { MeDto } from '@/types'

export interface UserState {
  telegramId: number | null
  username: string | null
  firstName: string | null
  balance: number
  balanceDisplay: string
  /** `true` sau khi `fetchMe()` thành công lần đầu (để view phân biệt với trạng thái chưa nạp). */
  loaded: boolean
}

const state = reactive<UserState>({
  telegramId: null,
  username: null,
  firstName: null,
  balance: 0,
  balanceDisplay: '',
  loaded: false,
})

/** Nạp thông tin người mua từ `GET /api/app/me` (Req 4.1, 12.1, 12.2). */
async function fetchMe(): Promise<void> {
  const me = await get<MeDto>('/me')
  state.telegramId = me.telegram_id
  state.username = me.username
  state.firstName = me.first_name
  state.balance = me.balance
  state.balanceDisplay = me.balance_display
  state.loaded = true
}

/**
 * Cập nhật số dư sau giao dịch (mua/nạp).
 * @param balance Số dư mới (INTEGER VNĐ).
 * @param display Chuỗi hiển thị từ server nếu có; thiếu thì format cục bộ cho khớp định dạng.
 */
function setBalance(balance: number, display?: string): void {
  state.balance = balance
  state.balanceDisplay = display ?? formatCurrency(balance)
}

/** Reset state khi cần (vd unauthorized) — không bắt buộc dùng. */
function reset(): void {
  state.telegramId = null
  state.username = null
  state.firstName = null
  state.balance = 0
  state.balanceDisplay = ''
  state.loaded = false
}

/**
 * Composable truy cập user store.
 * `state` là read-only đối với view — chỉ được đổi qua `fetchMe`/`setBalance`/`reset`.
 */
export function useUserStore(): {
  state: DeepReadonly<UserState>
  fetchMe: () => Promise<void>
  setBalance: (balance: number, display?: string) => void
  reset: () => void
} {
  return {
    state: readonly(state),
    fetchMe,
    setBalance,
    reset,
  }
}
