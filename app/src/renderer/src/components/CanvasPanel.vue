<script setup lang="ts">
import { computed, useTemplateRef, watch } from 'vue'
import { renderMarkdown } from '../canvas/markdown'
import type { Canvas } from '../canvas/store'

const { canvas, width, resizing } = defineProps<{
  canvas: Canvas
  width: number | undefined
  resizing: boolean
}>()

// 이 컴포넌트는 루트가 둘이라 `$el` 로 패널을 가리킬 수 없다.
const panel = useTemplateRef<HTMLElement>('panel')
defineExpose({ panel })

const view = useTemplateRef<HTMLDivElement>('view')
const doc = computed(() => canvas.selected.value)
const html = computed(() => (doc.value?.kind === 'markdown' ? renderMarkdown(doc.value.text) : ''))

// 같은 문서가 바뀔 때는 읽던 자리를 지킨다.
watch(
  () => canvas.selectedId.value,
  () => view.value?.scrollTo(0, 0),
  { flush: 'post' }
)
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
      <button class="close" title="Close" @mousedown.prevent @click="canvas.close()">✕</button>
    </header>
    <ul class="list">
      <li v-for="d in canvas.docs.value" :key="d.id">
        <button
          :class="{ selected: d.id === canvas.selectedId.value }"
          @mousedown.prevent
          @click="canvas.select(d.id)"
        >
          {{ d.title }}
        </button>
      </li>
    </ul>
    <div ref="view" class="view">
      <!-- eslint-disable-next-line vue/no-v-html -- renderMarkdown 이 DOMPurify 로 거른 HTML 이다 -->
      <div v-if="doc?.kind === 'markdown'" class="markdown" v-html="html" />
      <img v-else-if="doc?.kind === 'image'" class="image" :src="doc.url" :alt="doc.title" />
    </div>
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

.close {
  padding: 2px 6px;
}

.list {
  flex: none;
  max-height: calc(5 * 26px);
  overflow-y: auto;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  border-bottom: 1px solid var(--line);
}

.list button {
  display: block;
  width: 100%;
  height: 26px;
  padding: 0 12px;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list button:hover {
  background: var(--hover);
}

.list button.selected {
  background: var(--selected);
  color: var(--fg);
}

.view {
  flex: 1;
  overflow: auto;
  padding: 12px 16px;
}

.image {
  max-width: 100%;
}

.reopen {
  flex: none;
  writing-mode: vertical-rl;
  padding: 12px 4px;
  font-size: 12px;
  color: var(--muted);
}

.markdown :deep(a) {
  color: var(--accent);
}

.markdown :deep(code) {
  font-family: ui-monospace, monospace;
  font-size: 0.9em;
  background: var(--raised);
  padding: 0.1em 0.3em;
  border-radius: 3px;
}

.markdown :deep(pre) {
  overflow-x: auto;
  padding: 8px 12px;
  background: var(--raised);
  border-radius: 4px;
}

.markdown :deep(pre code) {
  padding: 0;
  background: none;
}

.markdown :deep(blockquote) {
  margin: 0;
  padding-left: 12px;
  border-left: 3px solid var(--faint);
  color: var(--muted);
}

.markdown :deep(table) {
  border-collapse: collapse;
}

.markdown :deep(th),
.markdown :deep(td) {
  padding: 4px 8px;
  border: 1px solid var(--line);
}

.markdown :deep(hr) {
  border: none;
  border-top: 1px solid var(--line);
}
</style>
