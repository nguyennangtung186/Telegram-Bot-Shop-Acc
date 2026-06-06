<script setup lang="ts">
// Layout gốc Mini App: tôn trọng safe-area của thiết bị + RouterView.
// Theme/màu/liquid-glass do design-system CSS (style.css) cung cấp qua biến CSS.
//
// Mount các lớp phản hồi UI toàn cục (đọc trạng thái từ @/stores/ui):
//  - ToastHost         : hàng đợi toast (thông báo lỗi/thành công) — trước đây bị "câm".
//  - LoadingOverlay    : lớp phủ loading khi có tác vụ async đang chạy.
//  - UnauthorizedScreen: màn "Mở lại từ Telegram" khi initData 401 (Req 1.7).
import ToastHost from '@/components/ToastHost.vue'
import LoadingOverlay from '@/components/LoadingOverlay.vue'
import UnauthorizedScreen from '@/components/UnauthorizedScreen.vue'
</script>

<template>
  <div class="app-shell">
    <RouterView />

    <!-- Lớp phản hồi UI toàn cục (overlay; không ảnh hưởng bố cục nội dung) -->
    <LoadingOverlay />
    <ToastHost />
    <UnauthorizedScreen />
  </div>
</template>

<style>
.app-shell {
  /* dvh để khớp viewport WebView Telegram (kể cả khi thanh công cụ ẩn/hiện) */
  min-height: 100vh;
  min-height: 100dvh;
  /* Safe-area insets (yêu cầu viewport-fit=cover ở index.html) */
  padding-top: env(safe-area-inset-top);
  padding-right: env(safe-area-inset-right);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  box-sizing: border-box;
}
</style>
