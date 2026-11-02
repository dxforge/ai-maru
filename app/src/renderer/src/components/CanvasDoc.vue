<script setup lang="ts">
import { computed, onBeforeUnmount, useTemplateRef, watch } from 'vue'
import { renderMarkdown } from '../canvas/markdown'
import type { CanvasEntry } from '../canvas/store'
import { attachOverlayScroll, detachOverlayScroll } from '../overlayScroll'

// 문서마다 렌더 결과를 computed 로 담아 두려고 컴포넌트로 뗐다. `CardStream` 은 붙는 제목이 바뀔 때마다 다시
// 그리는데, slot 에서 바로 렌더하면 그때마다 마크다운을 다시 렌더하기 때문이다.
const { doc } = defineProps<{ doc: CanvasEntry }>()
const html = computed(() => (doc.kind === 'markdown' ? renderMarkdown(doc.text) : ''))

// `v-html` 로 넣은 코드 블록(`pre`)에는 directive 를 달 수 없으므로, HTML 을 넣은 뒤에 `attachOverlayScroll` 로 스크롤바를 씌운다.
const root = useTemplateRef<HTMLElement>('root')
let blocks: HTMLElement[] = []
function release(): void {
  for (const b of blocks) detachOverlayScroll(b)
  blocks = []
}
watch(
  [root, html],
  ([el]) => {
    release()
    if (!el) return
    blocks = [...el.querySelectorAll<HTMLElement>('pre')]
    for (const b of blocks) attachOverlayScroll(b, 'x')
  },
  { flush: 'post' }
)
onBeforeUnmount(release)
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- renderMarkdown 이 DOMPurify 로 거른 HTML 이다 -->
  <div v-if="doc.kind === 'markdown'" ref="root" class="markdown" v-html="html" />
  <img v-else class="image" :src="doc.url" :alt="doc.title" />
</template>

<style scoped>
.image {
  max-width: 100%;
}

.markdown :deep(a) {
  color: var(--accent);
}

.markdown :deep(code) {
  font-family: var(--font-mono), monospace;
  font-size: 0.9em;
  background: var(--raised);
  padding: 0.1em 0.3em;
  border-radius: var(--radius-1);
}

.markdown :deep(pre) {
  overflow-x: auto;
  padding: var(--space-4) var(--space-5);
  background: var(--raised);
  border-radius: var(--radius-1);
}

.markdown :deep(pre code) {
  padding: 0;
  background: none;
}

.markdown :deep(blockquote) {
  margin: 0;
  padding-left: var(--space-5);
  border-left: 3px solid var(--faint);
  color: var(--muted);
}

.markdown :deep(table) {
  border-collapse: collapse;
}

.markdown :deep(th),
.markdown :deep(td) {
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--line);
}

.markdown :deep(hr) {
  border: none;
  border-top: 1px solid var(--line);
}
</style>
