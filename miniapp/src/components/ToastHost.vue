<script setup lang="ts">
/**
 * ToastHost — render hàng đợi toast toàn cục từ `ui` store (Req 13 — phản hồi UI).
 *
 * Mount một lần ở App.vue. Đọc `toasts` reactive và hiển thị mỗi toast dạng pill kính
 * (.glass, màu phẳng theo loại). Bấm vào toast → ẩn ngay (`dismissToast`).
 * Icon dùng SVG (lucide), KHÔNG emoji. Tôn trọng safe-area; không gradient (Req 13.3).
 */
import { CircleCheck, TriangleAlert, Info } from '@lucide/vue'
import type { Component } from 'vue'
import { useUiStore, type ToastType } from '@/stores/ui'

const ui = useUiStore()

/** Màu chữ theo loại toast (màu phẳng iOS, không chuyển-màu-nền). */
function toneClass(type: ToastType): string {
  switch (type) {
    case 'success':
      return 'text-ios-green'
    case 'error':
      return 'text-ios-red'
    default:
      return 'text-text'
  }
}

/** Icon SVG dẫn hướng nhanh theo loại toast. */
function iconFor(type: ToastType): Component {
  switch (type) {
    case 'success':
      return CircleCheck
    case 'error':
      return TriangleAlert
    default:
      return Info
  }
}
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 px-4"
    :style="{ paddingTop: 'calc(var(--safe-top) + 0.75rem)' }"
    aria-live="polite"
    aria-atomic="true"
  >
    <TransitionGroup name="toast">
      <button
        v-for="t in ui.toasts.value"
        :key="t.id"
        type="button"
        class="glass pointer-events-auto flex max-w-md items-center gap-2 px-4 py-3 text-left text-ios-footnote shadow-glass"
        @click="ui.dismissToast(t.id)"
      >
        <component
          :is="iconFor(t.type)"
          :size="18"
          :stroke-width="2"
          class="shrink-0"
          :class="toneClass(t.type)"
          aria-hidden="true"
        />
        <span :class="toneClass(t.type)">{{ t.message }}</span>
      </button>
    </TransitionGroup>
  </div>
</template>

<style scoped>
/* Easing iOS; tôn trọng prefers-reduced-motion (đã tắt transition toàn cục ở style.css). */
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--duration-ios) var(--ease-ios),
    transform var(--duration-ios) var(--ease-ios);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
