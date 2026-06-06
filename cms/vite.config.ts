import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  base: '/cms/',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: resolve(__dirname, '../dist/cms'),
    emptyOutDir: true,
    // Ghim target tương thích rộng (Vite 6 mặc định ~Safari 16/Chrome 107) để CMS chạy
    // được trên trình duyệt cũ; tránh trắng màn hình do cú pháp mới không parse được.
    target: ['es2019', 'chrome87', 'edge88', 'firefox78', 'safari13'],
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
