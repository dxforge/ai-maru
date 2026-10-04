<script setup lang="ts">
import { createCanvas } from './canvas/store'
import CanvasPanel from './components/CanvasPanel.vue'
import TerminalView from './components/TerminalView.vue'

const canvas = createCanvas()
window.maru.onCanvasPut(canvas.put)
</script>

<template>
  <div class="app">
    <TerminalView class="terminal" />
    <CanvasPanel :canvas="canvas" />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  height: 100%;
}

.terminal {
  flex: 1;
  min-width: 0;
  /* 다른 클라이언트가 primary 면 fit 하지 않아, 터미널이 남은 폭보다 넓으면 패널을 덮는다. */
  overflow: hidden;
}
</style>
