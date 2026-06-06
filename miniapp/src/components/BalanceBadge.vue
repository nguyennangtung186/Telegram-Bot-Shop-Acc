<script setup lang="ts">
/**
 * BalanceBadge — hiển thị số dư nổi bật trong lớp kính (Req 4.1, 4.2, 12.1).
 *  - `display` (chuỗi đã format từ server, vd "150,000đ") được ưu tiên để đồng
 *    bộ định dạng tiền tệ với hệ thống (Req 4.2).
 *  - fallback: format gọn từ `balance` (number) khi thiếu `display`.
 *  - màu phẳng + `.glass`, không chuyển-màu-nền.
 */
import { computed } from 'vue'
import { formatCurrency } from '@/utils/format'

const props = withDefaults(
  defineProps<{
    /** Số dư dạng số (đơn vị đồng). Dùng khi không có `display`. */
    balance?: number
    /** Chuỗi số dư đã định dạng từ server (ưu tiên hiển thị). */
    display?: string
    /** Nhãn phụ phía trên số dư. */
    label?: string
  }>(),
  { balance: 0, display: '', label: 'Số dư' }
)

/**
 * Ưu tiên `display` từ server; fallback định dạng phía client bằng `formatCurrency`
 * (cùng quy tắc backend — `en-US` separators) để định dạng tiền tệ THỐNG NHẤT (Req 4.2).
 */
const text = computed(() => (props.display ? props.display : formatCurrency(props.balance)))
</script>

<template>
  <div class="glass flex flex-col gap-1 p-5">
    <span class="text-ios-footnote text-hint">{{ label }}</span>
    <span class="text-ios-large-title tabular-nums text-text">{{ text }}</span>
  </div>
</template>
