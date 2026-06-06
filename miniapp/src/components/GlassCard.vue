<script setup lang="ts">
/**
 * GlassCard — vật liệu liquid glass tái sử dụng (Req 13.1, 13.2, 13.3).
 * Wrapper đơn giản: nền kính phẳng + blur + bo góc; nội dung qua slot mặc định.
 * Không chuyển-màu-nền — chỉ class `.glass` (màu phẳng + backdrop-blur + viền + bóng).
 */
withDefaults(
  defineProps<{
    /** Có áp padding mặc định hay không (tắt khi cần bố cục sát mép). */
    padded?: boolean
    /** Thẻ HTML gốc để render (div/section/article...). */
    as?: string
  }>(),
  { padded: true, as: 'div' }
)
</script>

<template>
  <component :is="as" class="glass" :class="padded ? 'p-4' : ''">
    <slot />
  </component>
</template>
