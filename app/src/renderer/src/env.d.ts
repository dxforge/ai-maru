/// <reference types="vite/client" />

import type { MaruApi } from '../../preload'

declare global {
  interface Window {
    maru: MaruApi
  }
}
