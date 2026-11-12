import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'pty-host': resolve('src/main/pty-host.ts')
        }
      }
    }
  },
  preload: {},
  renderer: {
    plugins: [vue()],
    // 코드 강조 worker 가 언어 문법을 필요할 때 따로 읽게 한다. 기본값 iife 는 모든 문법을 worker 파일 하나에 묶는다.
    worker: { format: 'es' }
  }
})
