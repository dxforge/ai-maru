<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { clockTime, type Canvas } from '../canvas/store'
import { ICONS } from '../icons'
import CanvasDoc from './CanvasDoc.vue'
import CardStream from './CardStream.vue'

const { canvas, width, resizing } = defineProps<{
  canvas: Canvas
  width: number | undefined
  resizing: boolean
}>()

// 이 컴포넌트는 루트가 둘이라 `$el` 로 패널을 가리킬 수 없다.
const panel = useTemplateRef<HTMLElement>('panel')
defineExpose({ panel })
</script>

<template>
  <!-- 패널의 버튼은 포커스를 가져가지 않는다 — 누른 뒤에도 키 입력은 터미널로 간다. -->
  <!-- 닫혀도 DOM 에 남겨 폭을 0 으로 줄인다 — display: none 이면 폭이 transition 하지 않는다. -->
  <aside
    ref="panel"
    class="canvas"
    :class="{ closed: !canvas.open.value, resizing }"
    :style="canvas.open.value && width !== undefined ? { flexBasis: `${width}px` } : {}"
  >
    <header class="bar">
      <span>Canvas</span>
      <span class="actions">
        <button
          class="expand-all"
          title="Expand all"
          @mousedown.prevent
          @click="canvas.expandAll()"
        >
          <span class="nerd-icon">{{ ICONS.expandAll }}</span>
        </button>
        <button
          class="collapse-all"
          title="Collapse all"
          @mousedown.prevent
          @click="canvas.collapseAll()"
        >
          <span class="nerd-icon">{{ ICONS.collapseAll }}</span>
        </button>
        <button class="close" title="Close" @mousedown.prevent @click="canvas.close()">
          <span class="nerd-icon">{{ ICONS.close }}</span>
        </button>
      </span>
    </header>
    <CardStream
      :items="canvas.docs.value"
      :expanded="canvas.expanded"
      @expand="canvas.expand"
      @remove="canvas.remove"
    >
      <template #meta="{ item }">{{ clockTime(item.at) }}</template>
      <template #body="{ item }"><CanvasDoc :doc="item" /></template>
    </CardStream>
  </aside>
  <button
    v-if="!canvas.open.value && canvas.docs.value.length"
    class="reopen"
    title="Open Canvas"
    @mousedown.prevent
    @click="canvas.reopen()"
  >
    Canvas
  </button>
</template>

<style scoped>
.canvas {
  /* 창이 좁아지면 끌어서 정한 폭보다 줄어든다 — 터미널 영역은 0 아래로 줄지 않는다. */
  flex: 0 1 45%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  color: var(--fg);
  font:
    14px/1.6 system-ui,
    sans-serif;
  transition: flex-basis var(--panel-duration) var(--panel-easing);
}

/* 다 접힌 뒤에 숨겨 패널 안 버튼이 포커스·클릭을 받지 않게 한다. */
.canvas.closed {
  flex-basis: 0;
  visibility: hidden;
  transition:
    flex-basis var(--panel-duration) var(--panel-easing),
    visibility 0s var(--panel-duration);
}

.canvas.resizing {
  transition: none;
}

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 4px 12px;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
  color: var(--muted);
  -webkit-app-region: drag;
}

.bar button {
  -webkit-app-region: no-drag;
}

button {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  cursor: pointer;
}

.actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.expand-all,
.collapse-all,
.close {
  padding: 2px 6px;
}

.expand-all:hover,
.collapse-all:hover,
.close:hover {
  color: var(--fg);
}

.reopen {
  flex: none;
  writing-mode: vertical-rl;
  padding: 12px 4px;
  font-size: 12px;
  color: var(--muted);
}
</style>
