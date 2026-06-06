/**
 * stores/ui.ts — trạng thái UI toàn cục (singleton reactive, không cần Pinia).
 *
 * Gồm:
 *  - `loading`      : cờ loading toàn cục (đếm tham chiếu để chịu được request chồng nhau).
 *  - `toasts`       : hàng đợi thông báo nổi (success/error/info), tự ẩn sau thời gian.
 *  - `unauthorized` : cờ do API client bật khi gặp 401 → app hiện màn "Mở lại từ Telegram" (Req 1.7).
 *  - `haptic`       : re-export mỏng quanh `haptic` của Telegram SDK (Req 13.5).
 *
 * Import qua `@/stores/ui`. Lưu ý: API client (`@/api/client`) phụ thuộc `setUnauthorized`
 * ở đây; ui store KHÔNG import ngược client để tránh phụ thuộc vòng.
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { haptic as sdkHaptic, type HapticKind } from '@/telegram/sdk'

// ── Loading ────────────────────────────────────────────────────────────────────────

/** Số request đang chạy. Dùng counter để loading chỉ tắt khi request cuối cùng kết thúc. */
const loadingCount = ref(0)

/** `true` khi có ít nhất một tác vụ đang chạy. */
export const loading: ComputedRef<boolean> = computed(() => loadingCount.value > 0)

/** Tăng bộ đếm loading (bắt đầu một tác vụ). */
export function startLoading(): void {
  loadingCount.value++
}

/** Giảm bộ đếm loading (kết thúc một tác vụ), không cho âm. */
export function stopLoading(): void {
  if (loadingCount.value > 0) loadingCount.value--
}

/**
 * Bọc một tác vụ async để tự bật/tắt `loading` (luôn tắt kể cả khi tác vụ ném lỗi).
 * @param task Promise hoặc factory trả Promise.
 */
export async function withLoading<T>(task: Promise<T> | (() => Promise<T>)): Promise<T> {
  startLoading()
  try {
    return await (typeof task === 'function' ? task() : task)
  } finally {
    stopLoading()
  }
}

// ── Toast ──────────────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  message: string
  type: ToastType
}

/** Thời gian hiển thị mặc định của một toast (ms). */
const TOAST_DURATION_MS = 3000

const toastQueue: Ref<Toast[]> = ref([])
let toastSeq = 0

/** Hàng đợi toast hiện tại (read-only đối với view). */
export const toasts: ComputedRef<Toast[]> = computed(() => toastQueue.value)

/**
 * Đẩy một toast vào hàng đợi.
 * @param durationMs > 0 sẽ tự ẩn sau khoảng đó; <= 0 giữ đến khi `dismissToast` thủ công.
 * @returns id của toast vừa tạo (để chủ động ẩn nếu cần).
 */
export function toast(message: string, type: ToastType = 'info', durationMs = TOAST_DURATION_MS): number {
  const id = ++toastSeq
  toastQueue.value.push({ id, message, type })
  if (durationMs > 0) {
    setTimeout(() => dismissToast(id), durationMs)
  }
  return id
}

/** Ẩn một toast theo id (no-op nếu đã bị gỡ). */
export function dismissToast(id: number): void {
  toastQueue.value = toastQueue.value.filter((t) => t.id !== id)
}

// ── Unauthorized (Req 1.7) ───────────────────────────────────────────────────────────

/**
 * Cờ chưa xác thực — bật bởi API client khi gặp 401 (thiếu/sai initData hoặc hết TTL).
 * App dùng cờ này để hiển thị màn "Mở lại từ Telegram" thay cho nội dung thường.
 */
export const unauthorized = ref(false)

/** Đặt trạng thái unauthorized (mặc định `true`). */
export function setUnauthorized(value = true): void {
  unauthorized.value = value
}

// ── Haptic (Req 13.5) ────────────────────────────────────────────────────────────────

/**
 * Re-export mỏng quanh haptic của Telegram SDK để view chỉ cần import từ ui store.
 * No-op khi chạy ngoài Telegram (xử lý trong sdk).
 */
export function haptic(kind: HapticKind): void {
  sdkHaptic(kind)
}

export type { HapticKind }

/** Truy cập gộp dạng composable cho view: `const ui = useUiStore()`. */
export function useUiStore() {
  return {
    loading,
    toasts,
    unauthorized,
    startLoading,
    stopLoading,
    withLoading,
    toast,
    dismissToast,
    setUnauthorized,
    haptic,
  }
}
