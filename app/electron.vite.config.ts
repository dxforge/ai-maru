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
    plugins: [vue()]
  }
})
