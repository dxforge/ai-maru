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
    worker: { format: 'es' },
    // dev 서버가 시작할 때 worker 의 의존성도 미리 최적화하게 한다. 시작 scan 은 index.html 에서 import 만 따라가고
    // `new Worker(new URL(...))` 안쪽은 보지 않는다. 그러면 Vite 는 worker 가 처음 뜰 때 그 의존성(코드 강조 worker 의
    // shiki)을 새로 찾아 페이지를 통째로 새로 고친다. 문서가 바뀌면 main 은 이전 문서의 pty 를 끈다(`docs/architecture.md`).
    // entries 를 주면 기본 진입(index.html)을 대신하므로 함께 넣는다.
    optimizeDeps: { entries: ['index.html', 'src/**/*.worker.ts'] }
  }
})
