<script setup lang="ts">
import { computed, onBeforeUnmount, useTemplateRef, watch } from 'vue'
import { BlockHighlighter, hasCodeBlock } from '../canvas/codeBlocks'
import { drawDiagrams, hasDiagram } from '../canvas/diagrams'
import { fillBody } from '../canvas/fill'
import { isFootnoteId } from '../canvas/footnotes'
import { zoomImage } from '../canvas/zoomBox'
import { loadMermaid } from '../canvas/mermaid'
import { bodyOf, codeBodyOf, type CanvasEntry } from '../canvas/store'
import { prefersDark } from '../colorScheme'
import { HoverScrollbars } from '../overlayScroll'
import CodeView from './CodeView.vue'

const { doc } = defineProps<{ doc: CanvasEntry }>()
const root = useTemplateRef<HTMLElement>('root')

// 첫 묶음은 렌더할 때 넣는다. 카드를 펼치거나 넣은 뒤 `CardStream` 이 카드 자리를 재는 post watcher 가 이 컴포넌트의
// watcher 보다 먼저 돌아, 그때 본문이 비어 있으면 잘못 잰 자리로 스크롤하기 때문이다.
// 같은 id 로 다시 온 문서는 `body.id` 를 key 로 새 요소에 그린다. `v-html` 은 첫 묶음을 감싼 요소의 내용만 바꾸므로,
// 같은 요소에 그리면 앞 문서의 나머지 묶음이 남는다.
const body = computed(() => bodyOf(doc))
const first = computed(() => body.value?.html(0) ?? '')
const code = computed(() => codeBodyOf(doc))
// 요소가 바뀌거나 사라지면(같은 id 로 이미지가 오면 이 컴포넌트는 남고 요소가 이미지 요소로 바뀐다) 앞 요소에 붙이던 것을 멈춘다.
let stop: (() => void) | undefined
let blocks: BlockHighlighter | undefined
function reset(): void {
  stop?.()
  stop = undefined
  blocks?.stop()
  blocks = undefined
  waiting = undefined
  scrollbars.release()
}
watch(
  root,
  (el) => {
    reset()
    if (!el || !body.value) return
    blocks = new BlockHighlighter(el, body.value.highlights)
    added(first.value)
    stop = fillBody(el, body.value, added)
  },
  { flush: 'post' }
)

function added(html: string): void {
  if (hasDiagram(html)) draw()
  if (hasCodeBlock(html)) blocks?.scan()
  if (waiting) jumpTo(waiting)
}

// 각주 번호·↩ 를 누르면 이 문서 안에서 대상을 찾아 스크롤하고, 기본 해시 이동은 막는다. 해시로 가면 창에서 처음 맞는
// id 로 가기 때문이다. 정의는 마지막 묶음에 있으므로, 그 묶음이 아직 붙지 않았으면 붙은 뒤에 간다.
let waiting: string | undefined
function follow(e: MouseEvent): void {
  const href = (e.target as Element).closest('a')?.getAttribute('href')
  if (!href?.startsWith('#') || !isFootnoteId(href.slice(1))) return
  e.preventDefault()
  waiting = href.slice(1)
  jumpTo(waiting)
}

let jumps = 0
function jumpTo(id: string): void {
  const target = root.value?.querySelector<HTMLElement>(`[id="${id}"]`)
  if (!target) return
  waiting = undefined
  void scrollTo(target, ++jumps)
}

// 화면 밖 묶음의 높이는 어림값이라, 스크롤해 대상 위의 묶음이 그려지면 대상이 움직인다. 그래서 대상이 제자리에 설 때까지
// 프레임마다 다시 맞춘다. 맞출 수 없는 자리(문서 끝)면 scrollTop 이 바뀌지 않아 멈춘다.
async function scrollTo(target: HTMLElement, jump: number): Promise<void> {
  const scroller = scrollParent(target)
  if (!scroller) return
  for (let i = 0; i < 10 && jump === jumps; i++) {
    const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0
    const from = scroller.scrollTop
    scroller.scrollTop =
      from + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - margin
    if (Math.abs(scroller.scrollTop - from) < 1) return
    await new Promise(requestAnimationFrame)
  }
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement)
    if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p
  return null
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
  const view = target.closest<HTMLElement>('.zoom-view')
  if (view) scrollbars.attach(view, 'both')
}
onBeforeUnmount(reset)
</script>

<template>
  <!-- 첫 묶음은 따로 감싼다. `fillBody` 가 그 높이로 나머지 묶음의 높이를 어림한다. -->
  <div
    v-if="doc.kind === 'markdown'"
    :key="body?.id"
    ref="root"
    class="markdown zoomable"
    :class="{ classic }"
    @pointerover="hover"
    @click="follow"
  >
    <!-- eslint-disable-next-line vue/no-v-html -- MarkdownBody 가 낸 HTML 이다. lexing 한 묶음은 DOMPurify 로 걸렀고, 글자 묶음은 escape 했다 -->
    <div v-html="first" />
  </div>
  <CodeView v-else-if="code" :key="code.id" :body="code" />
  <!-- 같은 id 로 다른 이미지가 오면 `doc.url` 을 key 로 새 요소에 그린다. 앞 이미지에 붙인 확대·축소를 남기지 않기 위해서다.
       이미지 요소에도 `ref="root"` 를 다는 것은, `root` 가 바뀌면 `watch(root)` 의 `reset()` 이 앞 이미지에 씌운 스크롤바를
       해제하기 때문이다. -->
  <div
    v-else-if="doc.kind === 'image'"
    :key="doc.url"
    ref="root"
    class="image-doc zoomable"
    :class="{ classic }"
    @pointerover="hover"
  >
    <div class="zoom">
      <div class="zoom-view">
        <img
          class="image"
          :src="doc.url"
          :alt="doc.title"
          @load="zoomImage($event.target as HTMLImageElement)"
        />
      </div>
    </div>
  </div>
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
.zoomable.classic :deep(.zoom-view) {
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
   않으므로, 코드 블록 안의 `span` 은 `BlockHighlighter` 가 넣은 것뿐이다. */
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

.zoomable :deep(.zoom) {
  position: relative;
}

/* 블록보다 작은 그림(다이어그램·이미지)은 가로·세로 가운데에 두고, 크면 블록 안에서 스크롤한다. flex 의 auto margin 은 넘칠 때 0 이
   되어 왼쪽·위 끝까지 스크롤할 수 있다. */
.zoomable :deep(.zoom-view) {
  display: flex;
  overflow: auto;
}

.zoomable :deep(.zoom-view.pannable) {
  cursor: grab;
}

.zoomable :deep(.zoom-view.dragging) {
  cursor: grabbing;
}

.zoomable :deep(.zoom-view > *) {
  flex: none;
  margin: auto;
}

.zoomable :deep(.zoom-bar) {
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

.zoomable :deep(.zoom:hover .zoom-bar) {
  visibility: visible;
}

.zoomable :deep(.zoom-bar button) {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  cursor: pointer;
}

/* 위의 `background: none` 이 `.icon-button:hover` 보다 앞서므로 hover 색을 다시 둔다. */
.zoomable :deep(.zoom-bar button:hover) {
  background: var(--hover);
}

.zoomable :deep(.zoom-reset) {
  width: auto;
  min-width: 36px;
  padding: 0 var(--space-2);
}

.markdown :deep(.diagram-error) {
  color: var(--error);
  font-size: var(--text-1);
}

.markdown :deep([id]) {
  scroll-margin-top: calc(var(--pinned-top, 0px) + var(--space-4));
}

.markdown :deep(.footnotes) {
  padding-left: var(--space-6);
  color: var(--muted);
}

.markdown :deep(hr) {
  border: none;
  border-top: 1px solid var(--line);
}
</style>
