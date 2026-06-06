<script setup lang="ts">
/**
 * DepositView — nạp tiền qua VietQR/SePay (Req 8.1, 8.4, 8.5, 13.5).
 *
 *  - Chọn mệnh giá định sẵn (grid 2×3, đồng bộ `PRESET_AMOUNTS` của bot) hoặc nhập số
 *    tiền thủ công; cả hai cùng ghi vào MỘT nguồn `amountInput` (chip chỉ điền sẵn ô nhập)
 *    để tránh lệch trạng thái (Req 8.1).
 *  - Dùng MainButton "Tạo mã nạp" của Telegram → `POST /api/app/deposits { amount }`. Số
 *    tiền do server kiểm tra lại theo `min_deposit`/`max_deposit`; lỗi 400 server trả
 *    message giới hạn cụ thể → hiển thị trực tiếp (Req 8.2). Thành công → haptic('success'),
 *    ẩn MainButton, hiển thị `QrPanel` (VietQR + thông tin chuyển khoản + transfer_code)
 *    (Req 8.4, 13.5).
 *  - Khi đang `pending`: hiển thị trạng thái chờ đối soát (Req 8.5) và poll
 *    `GET /api/app/deposits/:id` với backoff (3s → ×1.5 → tối đa 15s). Khi `completed`:
 *    haptic('success'), cập nhật số dư store nếu có `new_balance`, toast "Nạp tiền thành
 *    công", dừng poll. `expired`/`cancelled` → dừng poll + báo trạng thái. Việc cộng tiền
 *    thực tế do `/webhook/sepay` xử lý — endpoint này chỉ đọc trạng thái.
 *  - Lỗi mạng tạm thời khi poll → vẫn tiếp tục theo backoff, không phá vỡ UI; 401/404 →
 *    dừng poll. Timer được dọn trong `onUnmounted` để tránh rò rỉ; rời màn hình → ngừng poll.
 *  - BackButton của Telegram quay lại trang trước; MainButton/BackButton/timer đều được gỡ
 *    trong `onUnmounted` (Req 13.5).
 *
 * Bố cục mobile-first iOS HIG, chỉ dùng màu phẳng + lớp `.glass` — KHÔNG gradient (Req 13).
 */

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import GlassCard from '@/components/GlassCard.vue'
import GlassButton from '@/components/GlassButton.vue'
import QrPanel from '@/components/QrPanel.vue'
import { CircleCheck } from '@lucide/vue'
import { get, post, ApiError } from '@/api/client'
import { useUiStore } from '@/stores/ui'
import { useUserStore } from '@/stores/user'
import { showMainButton, showBackButton, type Cleanup } from '@/telegram/sdk'
import { formatCurrency } from '@/utils/format'
import type { DepositCreatedDto, DepositStatusDto } from '@/types'

/** Mệnh giá nạp nhanh — đồng bộ `PRESET_AMOUNTS` của bot (src/bot/callbacks/deposit.ts). */
const PRESET_AMOUNTS = [30_000, 50_000, 100_000, 200_000, 500_000, 1_000_000] as const

/** Backoff cho poll trạng thái nạp: bắt đầu 3s, nhân 1.5 mỗi lần, trần 15s. */
const POLL_START_MS = 3_000
const POLL_MAX_MS = 15_000
const POLL_FACTOR = 1.5

const router = useRouter()
const ui = useUiStore()
const user = useUserStore()

/** Chuỗi số tiền người dùng nhập (chỉ chứa chữ số). Chip mệnh giá chỉ điền sẵn ô này. */
const amountInput = ref('')
/** Yêu cầu nạp đã tạo (VietQR + thông tin CK); `null` khi đang ở bước chọn số tiền. */
const created = ref<DepositCreatedDto | null>(null)
/** Trạng thái đối soát hiện tại của yêu cầu nạp (cập nhật qua poll). */
const status = ref<DepositStatusDto['status']>('pending')
/** Cờ chống double-submit khi đang gửi yêu cầu tạo mã nạp. */
const submitting = ref(false)

/** Số tiền hợp lệ (số nguyên dương) suy ra từ ô nhập; `null` khi trống/không hợp lệ. */
const amount = computed<number | null>(() => {
  if (!amountInput.value) return null
  const n = Number(amountInput.value)
  return Number.isInteger(n) && n > 0 ? n : null
})

// ── Dọn dẹp nút Telegram + timer poll ────────────────────────────────────────────────

let cleanupBack: Cleanup = () => {}
let cleanupMain: Cleanup = () => {}

/** Cờ + handle timer cho vòng poll (dùng setTimeout đệ quy để áp backoff). */
let polling = false
let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollDelay = POLL_START_MS

// ── Chọn số tiền ──────────────────────────────────────────────────────────────────────

/** Chọn một mệnh giá định sẵn → điền vào ô nhập (Req 8.1). */
function selectPreset(value: number): void {
  ui.haptic('light')
  amountInput.value = String(value)
}

/** Lọc ô nhập chỉ còn chữ số để `amount` luôn là số nguyên VNĐ hợp lệ. */
function onAmountInput(event: Event): void {
  const el = event.target as HTMLInputElement
  const digits = el.value.replace(/\D/g, '')
  amountInput.value = digits
  // Đồng bộ lại DOM khi có ký tự bị loại (vd dán chuỗi có dấu phẩy).
  if (el.value !== digits) el.value = digits
}

// ── Poll trạng thái nạp ───────────────────────────────────────────────────────────────

/** Dừng poll và xoá timer (an toàn khi gọi nhiều lần). */
function stopPolling(): void {
  polling = false
  if (pollTimer !== null) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

/** Lên lịch lần poll kế tiếp theo backoff hiện tại (no-op nếu đã dừng). */
function scheduleNextPoll(): void {
  if (!polling) return
  pollTimer = setTimeout(() => {
    void pollOnce()
  }, pollDelay)
  pollDelay = Math.min(Math.round(pollDelay * POLL_FACTOR), POLL_MAX_MS)
}

/**
 * Một lần poll `GET /deposits/:id`.
 *  - `completed` → cập nhật số dư (nếu có `new_balance`) + toast + dừng.
 *  - `expired`/`cancelled` → báo trạng thái + dừng.
 *  - `pending` → lên lịch lần kế tiếp.
 *  - Lỗi mạng tạm thời → tiếp tục backoff; 401/404 → dừng (không phá vỡ UI).
 */
async function pollOnce(): Promise<void> {
  if (!polling || !created.value) return
  try {
    const res = await get<DepositStatusDto>(`/deposits/${created.value.deposit_id}`)
    if (!polling) return // đã rời màn hình trong lúc chờ phản hồi

    if (res.status === 'completed') {
      stopPolling()
      status.value = 'completed'
      if (typeof res.new_balance === 'number') user.setBalance(res.new_balance)
      ui.haptic('success') // Req 13.5
      ui.toast('Nạp tiền thành công', 'success')
      return
    }

    if (res.status === 'expired' || res.status === 'cancelled') {
      stopPolling()
      status.value = res.status
      ui.toast(
        res.status === 'expired' ? 'Yêu cầu nạp đã hết hạn.' : 'Yêu cầu nạp đã bị huỷ.',
        'info'
      )
      return
    }

    // pending → tiếp tục chờ
    status.value = 'pending'
    scheduleNextPoll()
  } catch (err) {
    // 401: client đã bật màn "Mở lại từ Telegram"; 404: deposit không còn → dừng poll.
    if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
      stopPolling()
      return
    }
    // Lỗi mạng tạm thời → vẫn tiếp tục poll theo backoff (không phá vỡ UI).
    scheduleNextPoll()
  }
}

/** Bắt đầu vòng poll từ đầu (reset backoff). */
function startPolling(): void {
  stopPolling()
  polling = true
  pollDelay = POLL_START_MS
  scheduleNextPoll()
}

// ── Tạo yêu cầu nạp ───────────────────────────────────────────────────────────────────

/** Dịch lỗi tạo nạp sang thông báo tiếng Việt cho người mua. */
function depositErrorMessage(err: ApiError): string {
  // 400 (giới hạn min/max) và 429 (luật nạp: cooldown / quá nhiều pending) đều trả message
  // tiếng Việt cụ thể từ server → hiển thị trực tiếp (Req 8.2).
  if (err.status === 400 || err.status === 429) return err.error
  switch (err.error) {
    case 'db_error':
      return 'Lỗi hệ thống. Vui lòng thử lại.'
    default:
      return 'Tạo mã nạp thất bại. Vui lòng thử lại.'
  }
}

/**
 * Gửi yêu cầu tạo mã nạp (Req 8.3, 8.4). Số tiền do server kiểm tra lại theo min/max;
 * thành công → hiển thị QR + bắt đầu poll; thất bại → toast + haptic('error').
 */
async function submitDeposit(): Promise<void> {
  if (submitting.value || created.value) return
  const value = amount.value
  if (value === null) {
    ui.haptic('error')
    ui.toast('Vui lòng nhập số tiền nạp.', 'error')
    return
  }

  submitting.value = true
  try {
    const res = await ui.withLoading(post<DepositCreatedDto>('/deposits', { amount: value }))
    created.value = res
    status.value = 'pending'
    ui.haptic('success') // Req 13.5
    // Ẩn MainButton sau khi tạo để tránh tạo trùng trên màn QR.
    cleanupMain()
    cleanupMain = () => {}
    startPolling()
  } catch (err) {
    ui.haptic('error')
    if (err instanceof ApiError) {
      if (err.status === 401) return // client đã xử lý màn "Mở lại từ Telegram"
      ui.toast(depositErrorMessage(err), 'error')
    } else {
      ui.toast('Tạo mã nạp thất bại. Vui lòng thử lại.', 'error')
    }
  } finally {
    submitting.value = false
  }
}

/** Quay lại bước chọn số tiền để tạo mã nạp khác (dừng poll + hiện lại MainButton). */
function resetDeposit(): void {
  stopPolling()
  created.value = null
  status.value = 'pending'
  setupMainButton()
}

/** Hiển thị MainButton "Tạo mã nạp" khi đang ở bước chọn số tiền; ẩn khi đã tạo. */
function setupMainButton(): void {
  cleanupMain()
  cleanupMain = () => {}
  if (created.value) return
  cleanupMain = showMainButton('Tạo mã nạp', () => {
    void submitDeposit()
  })
}

onMounted(() => {
  cleanupBack = showBackButton(() => router.back())
  setupMainButton()
})

onUnmounted(() => {
  cleanupBack()
  cleanupMain()
  stopPolling()
})
</script>

<template>
  <main class="flex flex-col gap-5 px-4 py-6">
    <header class="flex flex-col gap-1">
      <h1 class="text-ios-title text-text">Nạp tiền</h1>
      <p class="text-ios-footnote text-hint">
        Chọn mệnh giá hoặc nhập số tiền, sau đó tạo mã VietQR để chuyển khoản.
      </p>
    </header>

    <!-- Bước chọn số tiền (Req 8.1) — chỉ hiện khi chưa tạo yêu cầu nạp -->
    <template v-if="!created">
      <section class="flex flex-col gap-3" aria-label="Mệnh giá nạp nhanh">
        <h2 class="px-1 text-ios-footnote text-hint">Mệnh giá nhanh</h2>
        <div class="grid grid-cols-2 gap-3">
          <button
            v-for="preset in PRESET_AMOUNTS"
            :key="preset"
            type="button"
            class="tap-target rounded-ios px-4 py-3 text-ios-headline tabular-nums transition-[transform,background-color] duration-ios ease-ios active:scale-[0.97]"
            :class="amount === preset ? 'bg-accent text-accent-text' : 'glass text-text'"
            :aria-pressed="amount === preset"
            @click="selectPreset(preset)"
          >
            {{ formatCurrency(preset) }}
          </button>
        </div>
      </section>

      <section class="flex flex-col gap-2" aria-label="Nhập số tiền">
        <h2 class="px-1 text-ios-footnote text-hint">Hoặc nhập số tiền</h2>
        <div class="glass flex items-center gap-2 px-4 py-3">
          <input
            :value="amountInput"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            placeholder="0"
            aria-label="Số tiền nạp"
            class="w-full bg-transparent text-ios-title tabular-nums text-text outline-none placeholder:text-hint"
            @input="onAmountInput"
          />
          <span class="text-ios-title text-hint" aria-hidden="true">đ</span>
        </div>
        <p v-if="amount" class="px-1 text-ios-footnote text-hint">
          Nạp <span class="text-text">{{ formatCurrency(amount) }}</span>
        </p>
      </section>
    </template>

    <!-- Sau khi tạo: trạng thái đối soát + VietQR (Req 8.4, 8.5) -->
    <template v-if="created">
      <!-- Đang chờ đối soát (Req 8.5) -->
      <GlassCard v-if="status === 'pending'">
        <div class="flex items-center gap-3">
          <span
            class="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"
            aria-hidden="true"
          />
          <div class="flex flex-col">
            <span class="text-ios-headline text-text">Đang chờ đối soát</span>
            <span class="text-ios-footnote text-hint">
              Số dư sẽ được cộng tự động sau khi chuyển khoản thành công.
            </span>
          </div>
        </div>
      </GlassCard>

      <!-- Nạp thành công -->
      <GlassCard v-else-if="status === 'completed'">
        <div class="flex flex-col items-center gap-2 text-center">
          <CircleCheck :size="40" :stroke-width="1.75" class="text-ios-green" aria-hidden="true" />
          <h2 class="text-ios-headline text-text">Nạp tiền thành công</h2>
          <p class="text-ios-footnote text-hint">Số dư của bạn đã được cập nhật.</p>
        </div>
      </GlassCard>

      <!-- Hết hạn / huỷ -->
      <GlassCard v-else>
        <p class="text-center text-ios-body text-ios-red">
          {{ status === 'expired' ? 'Yêu cầu nạp đã hết hạn.' : 'Yêu cầu nạp đã bị huỷ.' }}
        </p>
      </GlassCard>

      <!-- VietQR + thông tin chuyển khoản — chỉ còn ý nghĩa khi đang chờ đối soát (Req 8.4) -->
      <QrPanel
        v-if="status === 'pending'"
        :qr-url="created.qr_url"
        :bank-name="created.bank_name"
        :bank-account="created.bank_account"
        :bank-owner="created.bank_owner"
        :amount-display="created.amount_display"
        :transfer-code="created.transfer_code"
      />

      <GlassButton variant="secondary" block @click="resetDeposit">
        Tạo mã nạp khác
      </GlassButton>
    </template>
  </main>
</template>
