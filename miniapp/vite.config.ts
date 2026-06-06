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
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
