<script setup lang="ts">
/**
 * EmptyState — trạng thái trống tái sử dụng (vd lịch sử đơn rỗng — Req 11.4).
 *  - icon SVG (lucide) + tiêu đề + mô tả; slot `action` cho nút thao tác (tùy chọn).
 *  - màu phẳng theo token, không chuyển-màu-nền. KHÔNG dùng emoji (chỉ icon SVG).
 */
import { Inbox } from '@lucide/vue'
import type { Component } from 'vue'

withDefaults(
  defineProps<{
    /** Icon minh hoạ (component lucide SVG). */
    icon?: Component
    /** Tiêu đề trạng thái trống. */
    title: string
    /** Mô tả phụ (tùy chọn). */
    description?: string
  }>(),
  { icon: () => Inbox, description: '' }
)
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
    <component :is="icon" :size="48" :stroke-width="1.5" class="text-hint" aria-hidden="true" />
    <h2 class="text-ios-headline text-text">{{ title }}</h2>
    <p v-if="description" class="text-ios-footnote text-hint">{{ description }}</p>
    <div v-if="$slots.action" class="mt-2">
      <slot name="action" />
    </div>
  </div>
</template>
