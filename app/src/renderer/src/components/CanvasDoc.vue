<script setup lang="ts">
import { computed, onBeforeUnmount, useTemplateRef, watch } from 'vue'
import { fillBody } from '../canvas/fill'
import { bodyOf, codeBodyOf, type CanvasEntry } from '../canvas/store'
import { HoverScrollbars } from '../overlayScroll'
import CodeView from './CodeView.vue'

const { doc } = defineProps<{ doc: CanvasEntry }>()
const root = useTemplateRef<HTMLElement>('root')

// 첫 묶음은 렌더할 때 넣는다. 카드를 펼치거나 넣은 뒤 `CardStream` 이 카드 자리를 재는 post watcher 가 이 컴포넌트의
// watcher 보다 먼저 돌아, 그때 본문이 비어 있으면 잘못 잰 자리로 스크롤하기 때문이다.
// 같은 id 로 다시 온 문서는 `body.id` 를 key 로 새 요소에 그린다. 첫 묶음의 HTML 이 같으면 `v-html` 이 요소를 비우지
// 않아, 앞 문서의 나머지 묶음이 남기 때문이다.
const body = computed(() => bodyOf(doc))
const first = computed(() => body.value?.html(0) ?? '')
const code = computed(() => codeBodyOf(doc))
// 요소가 바뀌거나 사라지면(같은 id 로 이미지가 오면 이 컴포넌트는 남고 요소만 사라진다) 앞 요소에 붙이던 것을 멈춘다.
let stop: (() => void) | undefined
function reset(): void {
  stop?.()
  stop = undefined
  scrollbars.release()
}
watch(
  root,
  (el) => {
    reset()
    if (el && body.value) stop = fillBody(el, body.value)
  },
  { flush: 'post' }
)

const scrollbars = new HoverScrollbars()
const classic = scrollbars.classic
function hover(e: PointerEvent): void {
  const pre = (e.target as Element).closest('pre')
  if (pre) scrollbars.attach(pre)
}
onBeforeUnmount(reset)
</script>

<template>
  <!-- eslint-disable vue/no-v-html -- MarkdownBody 가 낸 HTML 이다. lexing 한 묶음은 DOMPurify 로 걸렀고, 글자 묶음은 escape 했다 -->
  <div
    v-if="doc.kind === 'markdown'"
    :key="body?.id"
    ref="root"
    class="markdown"
    :class="{ classic }"
    @pointerover="hover"
    v-html="first"
  />
  <!-- eslint-enable vue/no-v-html -->
  <CodeView v-else-if="code" :key="code.id" :body="code" />
  <img v-else-if="doc.kind === 'image'" class="image" :src="doc.url" :alt="doc.title" />
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

/* 고전 스크롤바 설정에서 스크롤바를 씌우기 전의 블록이 시스템 스크롤바로 높이를 바꾸지 않게 한다. */
.markdown.classic :deep(pre) {
  scrollbar-width: none;
}

.markdown :deep(.plain) {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
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
