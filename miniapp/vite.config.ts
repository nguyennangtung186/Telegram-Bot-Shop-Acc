import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// Mini App SPA build config.
// - base '/app/'  : khớp route serve `/app` trong Worker (createWebHistory('/app/')).
// - outDir        : build ra ../dist/miniapp để Worker serve cùng bucket dist.
// - server.proxy  : dev proxy /api → Worker local (wrangler dev, port 8787).
export default defineConfig({
  plugins: [vue()],
  base: '/app/',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: resolve(__dirname, '../dist/miniapp'),
    emptyOutDir: true,
    // Telegram WebView (iOS WKWebView theo phiên bản iOS, Android System WebView) có thể
    // cũ hơn nhiều so với trình duyệt desktop. Vite 6 mặc định target 'baseline-widely-available'
    // (~Safari 16 / Chrome 107) → bundle chứa cú pháp mới, WebView cũ KHÔNG parse được →
    // Mini App trắng màn hình. Ghim target về mức rộng để esbuild hạ cú pháp (optional chaining,
    // nullish, …) cho thiết bị cũ (iOS 13.4+/Android WebView 87+).
    target: ['es2019', 'chrome87', 'edge88', 'firefox78', 'safari13'],
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
