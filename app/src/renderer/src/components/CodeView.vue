<script setup lang="ts">
import { onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import type { CodeBody } from '../canvas/code'
import { HoverScrollbars } from '../overlayScroll'

const { body } = defineProps<{ body: CodeBody }>()
const root = useTemplateRef<HTMLElement>('root')
const band = useTemplateRef<HTMLElement>('band')

// 강조는 worker 에서 받는다. 받기 전과 강조하지 않는 파일은 글자만 그린다. `CanvasDoc` 이 본문마다 이 컴포넌트를 새로
// 만들므로, 앞 본문의 결과가 늦게 와도 지금 본문에 붙지 않는다.
const html = ref(body.html ?? null)
void body.highlighted().then((h) => (html.value = h))

// `CardStream` 이 카드 자리를 맞추는 post watcher 가 먼저 돈 뒤에 그 줄로 스크롤한다. 닫혀 있던 Canvas 가 이 문서로
// 열리면 그때는 패널의 폭이 0 이라 스크롤되지 않으므로, 폭이 생기기를 기다린다.
let sized: ResizeObserver | undefined
watch(
  band,
  (el) => {
    if (!el || !root.value || !body.firstScroll()) return
    const scroll = (): void => el.scrollIntoView({ block: 'center', inline: 'nearest' })
    if (root.value.clientWidth > 0) return scroll()
    sized = new ResizeObserver(([e]) => {
      if (e.contentRect.width === 0) return
      sized?.disconnect()
      scroll()
    })
    sized.observe(root.value)
  },
  { flush: 'post' }
)
onBeforeUnmount(() => sized?.disconnect())

// 가로 스크롤바는 `CanvasDoc` 의 코드 블록처럼 포인터가 처음 들어올 때 씌운다.
const scrollbars = new HoverScrollbars()
const classic = scrollbars.classic
function hover(): void {
  if (root.value) scrollbars.attach(root.value)
}
onBeforeUnmount(() => scrollbars.release())
</script>

<template>
  <div ref="root" class="code" :class="{ classic }" @pointerenter="hover">
    <div class="lines">
      <div
        v-if="body.line"
        ref="band"
        class="band"
        :style="{ top: `calc(${body.line - 1} * var(--code-line))` }"
      />
      <pre class="gutter" aria-hidden="true">{{ body.numbers }}</pre>
      <!-- eslint-disable-next-line vue/no-v-html -- highlight.ts 의 tokensHtml 이 글자와 style 을 escape 한 HTML 이다 -->
      <pre v-if="html !== null" class="text" v-html="html" />
      <pre v-else class="text">{{ body.code }}</pre>
    </div>
  </div>
</template>

<style scoped>
.code {
  --code-line: calc(var(--text-2) * 1.5);
  overflow-x: auto;
  background: var(--raised);
  border-radius: var(--radius-1);
}

/* 고전 스크롤바 설정에서 스크롤바를 씌우기 전에 시스템 스크롤바로 높이를 바꾸지 않게 한다. */
.code.classic {
  scrollbar-width: none;
}

.lines {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr;
  width: max-content;
  min-width: 100%;
  padding: var(--space-4) 0;
}

pre {
  margin: 0;
  font:
    var(--text-2) / var(--code-line) var(--font-mono),
    monospace;
}

.band {
  position: absolute;
  left: 0;
  right: 0;
  height: var(--code-line);
  margin-top: var(--space-4);
  background: var(--selected);
  pointer-events: none;
  /* sticky 인 줄 번호 위에도 그린다. */
  z-index: 1;
}

.gutter {
  position: sticky;
  left: 0;
  padding: 0 var(--space-4) 0 var(--space-5);
  text-align: right;
  color: var(--faint);
  background: var(--raised);
  user-select: none;
}

.text {
  padding-right: var(--space-5);
  color: var(--fg);
}

/* 라이트·다크는 `prefers-color-scheme` 으로 고른다. 터미널 테마가 하나면 `themeSource` 를 그 테마의 밝기로 두고, 한 쌍이면 OS 를
   따라 고른 테마를 쓰므로(`themes/index.ts`) 이 값이 배경과 맞는다. */
.text :deep(span) {
  color: var(--shiki-light);
}

@media (prefers-color-scheme: dark) {
  .text :deep(span) {
    color: var(--shiki-dark);
  }
}
</style>
