import { createApp } from 'vue'
import { GHOSTTY, uiColors } from '../../shared/theme'
import App from './App.vue'
import './style.css'

for (const [name, color] of Object.entries(uiColors(GHOSTTY)))
  document.documentElement.style.setProperty(
    `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
    color
  )

createApp(App).mount('#app')
