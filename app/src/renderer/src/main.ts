import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

// 글꼴이 로드되기 전에 그린 Nerd Font 글자는 로드된 뒤에도 fallback 글꼴의 빈 네모로 남는다.
void document.fonts.load("1em 'Symbols Nerd Font Mono'").finally(() => createApp(App).mount('#app'))
