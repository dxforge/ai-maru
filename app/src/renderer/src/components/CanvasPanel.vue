<script setup lang="ts">
import { computed, useTemplateRef, watch } from 'vue'
import { renderMarkdown } from '../canvas/markdown'
import type { Canvas } from '../canvas/store'

const { canvas } = defineProps<{ canvas: Canvas }>()

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
  <aside v-show="canvas.open.value" class="canvas">
    <header class="bar">
      <span>Canvas</span>
      <button class="close" title="닫기" @mousedown.prevent @click="canvas.close()">✕</button>
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
    title="Canvas 열기"
    @mousedown.prevent
    @click="canvas.reopen()"
  >
    Canvas
  </button>
</template>

<style scoped>
.canvas {
  flex: 0 0 45%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-left: 1px solid #3c3c3c;
  color: #d4d4d4;
  font:
    14px/1.6 system-ui,
    sans-serif;
}

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 4px 12px;
  border-bottom: 1px solid #3c3c3c;
  font-size: 12px;
  color: #9d9d9d;
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
  border-bottom: 1px solid #3c3c3c;
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
  background: #2a2d2e;
}

.list button.selected {
  background: #37373d;
  color: #fff;
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
  border-left: 1px solid #3c3c3c;
  font-size: 12px;
  color: #9d9d9d;
}

.markdown :deep(a) {
  color: #4daafc;
}

.markdown :deep(code) {
  font-family: ui-monospace, monospace;
  font-size: 0.9em;
  background: #2d2d2d;
  padding: 0.1em 0.3em;
  border-radius: 3px;
}

.markdown :deep(pre) {
  overflow-x: auto;
  padding: 8px 12px;
  background: #2d2d2d;
  border-radius: 4px;
}

.markdown :deep(pre code) {
  padding: 0;
  background: none;
}

.markdown :deep(blockquote) {
  margin: 0;
  padding-left: 12px;
  border-left: 3px solid #555;
  color: #a0a0a0;
}

.markdown :deep(table) {
  border-collapse: collapse;
}

.markdown :deep(th),
.markdown :deep(td) {
  padding: 4px 8px;
  border: 1px solid #3c3c3c;
}

.markdown :deep(hr) {
  border: none;
  border-top: 1px solid #3c3c3c;
}
</style>
