import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'session-host': resolve('src/main/session-host.ts')
        }
      }
    }
  },
  preload: {},
  renderer: {
    plugins: [vue()],
    // 작은 글꼴을 data: URL 로 넣으면 CSP 의 default-src 'self' 가 막는다.
    build: { assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined) }
  }
})
