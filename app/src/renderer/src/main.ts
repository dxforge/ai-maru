import { createApp } from 'vue'
import App from './App.vue'
import { warmHighlighter } from './canvas/code'
import { vOverlayScroll } from './overlayScroll'
import { vTooltip } from './tooltip'
import './style.css'

// xterm 은 글꼴 로드를 듣지 않는다. 그래서 로드되기 전에 그린 Nerd Font 글자는 로드된 뒤에도 fallback 글꼴의 빈 네모로 남는 것으로 보인다.
void document.fonts
  .load("1em 'Symbols Nerd Font Mono'")
  .finally(() =>
    createApp(App)
      .directive('overlay-scroll', vOverlayScroll)
      .directive('tooltip', vTooltip)
      .mount('#app')
  )
requestIdleCallback(warmHighlighter)
