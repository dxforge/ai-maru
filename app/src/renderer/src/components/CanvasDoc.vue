<script setup lang="ts">
import { computed, onBeforeUnmount, useTemplateRef, watch } from 'vue'
import { hasCodeBlock, highlightBlocks } from '../canvas/codeBlocks'
import { drawDiagrams, hasDiagram } from '../canvas/diagrams'
import { fillBody } from '../canvas/fill'
import { loadMermaid } from '../canvas/mermaid'
import { bodyOf, codeBodyOf, type CanvasEntry } from '../canvas/store'
import { prefersDark } from '../colorScheme'
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
    if (!el || !body.value) return
    added(first.value)
    stop = fillBody(el, body.value, added)
  },
  { flush: 'post' }
)

function added(html: string): void {
  if (hasDiagram(html)) draw()
  if (hasCodeBlock(html) && root.value && body.value)
    void highlightBlocks(root.value, body.value.highlights)
}

function draw(): void {
  if (root.value && body.value)
    void drawDiagrams(root.value, body.value.diagrams, prefersDark.value, loadMermaid)
}
// 다이어그램을 그린 적 없는 본문은 다시 그릴 것이 없다. `drawDiagrams` 는 블록을 찾으면 바로 캐시를 채운다.
watch(prefersDark, () => {
  if (body.value?.diagrams.size) draw()
})

const scrollbars = new HoverScrollbars()
const classic = scrollbars.classic
function hover(e: PointerEvent): void {
  if (!classic) return
  const target = e.target as Element
  const pre = target.closest<HTMLElement>('pre')
  if (pre) scrollbars.attach(pre)
  const view = target.closest<HTMLElement>('.diagram-view')
  if (view) scrollbars.attach(view, 'both')
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
.markdown.classic :deep(pre),
.markdown.classic :deep(.diagram-view) {
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

/* 강조한 코드 블록의 색은 `CodeView` 의 `.text` 처럼 `prefers-color-scheme` 으로 고른다. sanitize 가 `span` 을 남기지
   않으므로, 코드 블록 안의 `span` 은 `highlightBlocks` 가 넣은 것뿐이다. */
.markdown :deep(pre code span) {
  color: var(--shiki-light);
}

@media (prefers-color-scheme: dark) {
  .markdown :deep(pre code span) {
    color: var(--shiki-dark);
  }
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

.markdown :deep(.diagram) {
  position: relative;
}

/* 블록보다 작은 다이어그램은 가로·세로 가운데에 두고, 크면 블록 안에서 스크롤한다. flex 의 auto margin 은 넘칠 때 0 이
   되어 왼쪽·위 끝까지 스크롤할 수 있다. */
.markdown :deep(.diagram-view) {
  display: flex;
  overflow: auto;
}

.markdown :deep(.diagram-view.pannable) {
  cursor: grab;
}

.markdown :deep(.diagram-view.dragging) {
  cursor: grabbing;
}

.markdown :deep(.diagram-view svg) {
  flex: none;
  margin: auto;
}

.markdown :deep(.diagram-zoom) {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  display: flex;
  gap: var(--space-1);
  padding: var(--space-1);
  background: var(--raised);
  border: 1px solid var(--line);
  border-radius: var(--radius-2);
  font-size: var(--text-1);
  color: var(--fg);
  visibility: hidden;
}

.markdown :deep(.diagram:hover .diagram-zoom) {
  visibility: visible;
}

.markdown :deep(.diagram-zoom button) {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  cursor: pointer;
}

/* 위의 `background: none` 이 `.icon-button:hover` 보다 앞서므로 hover 색을 다시 둔다. */
.markdown :deep(.diagram-zoom button:hover) {
  background: var(--hover);
}

.markdown :deep(.diagram-zoom-reset) {
  width: auto;
  min-width: 36px;
  padding: 0 var(--space-2);
}

.markdown :deep(.diagram-error) {
  color: var(--error);
  font-size: var(--text-1);
}

.markdown :deep(hr) {
  border: none;
  border-top: 1px solid var(--line);
}
</style>
