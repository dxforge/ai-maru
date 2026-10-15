import { createApp } from 'vue'
import { GHOSTTY, uiColors } from '../../shared/theme'
import App from './App.vue'
import './style.css'

for (const [name, color] of Object.entries(uiColors(GHOSTTY)))
  document.documentElement.style.setProperty(
    `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
    color
  )

// 글꼴이 실리기 전에 그린 Nerd Font 글자는 실린 뒤에도 앞 글꼴의 빈 네모로 남는다.
void document.fonts.load("1em 'Symbols Nerd Font Mono'").finally(() => createApp(App).mount('#app'))
