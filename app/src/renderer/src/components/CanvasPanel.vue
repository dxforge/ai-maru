<script setup lang="ts">
import { ref, useTemplateRef, watch } from 'vue'
import { clockTime, type Canvas } from '../canvas/store'
import { ICONS } from '../icons'
import { commandLabel } from '../../../shared/shortcuts'
import CanvasDoc from './CanvasDoc.vue'
import CanvasViewMenu from './CanvasViewMenu.vue'
import CardStream from './CardStream.vue'
import CellName from './CellName.vue'

const { canvas, width, resizing } = defineProps<{
  canvas: Canvas
  width: number | undefined
  resizing: boolean
}>()

// 이 컴포넌트는 루트가 둘이라 `$el` 로 패널을 가리킬 수 없다.
const panel = useTemplateRef<HTMLElement>('panel')
defineExpose({ panel })

// 닫기 시작해서 다시 열려 폭 transition 이 끝날 때까지 카드 줄기는 닫기 시작할 때의 폭으로 그린다. 폭을 따라가면 닫힌
// 동안(폭 0) 들어온 문서의 자리를 0 폭에서 잰 카드 높이로 맞추게 되어, 다시 열면 읽던 곳과 다른 곳이 보이기 때문이다.
const frozen = ref<number>()

const moving = (): boolean =>
  !!panel.value
    ?.getAnimations()
    .some(
      (a) =>
        a.playState === 'running' &&
        a instanceof CSSTransition &&
        a.transitionProperty === 'flex-basis'
    )

function thaw(): void {
  if (canvas.open.value && !moving()) frozen.value = undefined
}

watch(
  () => canvas.open.value,
  (open) => {
    if (!open) frozen.value ??= panel.value?.clientWidth || undefined
    // 폭이 그대로라 transition 이 생기지 않으면 `transitionend` 도 오지 않는다.
    else requestAnimationFrame(thaw)
  },
  { flush: 'pre' }
)

function onTransition(e: TransitionEvent): void {
  if (e.target === panel.value && e.propertyName === 'flex-basis') thaw()
}
</script>

<template>
  <!-- 패널의 버튼은 포커스를 가져가지 않는다 — 누른 뒤에도 키 입력은 터미널로 간다. -->
  <!-- 닫혀도 DOM 에 남겨 폭을 0 으로 줄인다 — display: none 이면 폭이 transition 하지 않는다. -->
  <aside
    ref="panel"
    class="canvas"
    :class="{ closed: !canvas.open.value, resizing }"
    :style="canvas.open.value && width !== undefined ? { flexBasis: `${width}px` } : {}"
    @transitionend="onTransition"
    @transitioncancel="onTransition"
    @mouseenter="canvas.hold(true)"
    @mouseleave="canvas.hold(false)"
  >
    <header class="bar">
      <CanvasViewMenu :canvas="canvas" />
      <span class="actions">
        <button
          v-tooltip="'Expand all'"
          class="expand-all"
          aria-label="Expand all"
          @mousedown.prevent
          @click="canvas.expandAll()"
        >
          <span class="nerd-icon">{{ ICONS.expandAll }}</span>
        </button>
        <button
          v-tooltip="'Collapse all'"
          class="collapse-all"
          aria-label="Collapse all"
          @mousedown.prevent
          @click="canvas.collapseAll()"
        >
          <span class="nerd-icon">{{ ICONS.collapseAll }}</span>
        </button>
        <button
          v-tooltip="{ text: 'Close Canvas', keys: commandLabel('toggle-canvas') }"
          class="close"
          aria-label="Close Canvas"
          @mousedown.prevent
          @click="canvas.close()"
        >
          <span class="nerd-icon">{{ ICONS.close }}</span>
        </button>
      </span>
    </header>
    <!-- 보기를 바꾸면 다시 만든다. 그대로 두면 새로 보이는 문서를 모두 방금 온 문서로 강조하기 때문이다. -->
    <CardStream
      :key="String(canvas.viewCell.value)"
      :items="canvas.shown.value"
      :expanded="canvas.expanded"
      :held="canvas.held.value"
      :style="frozen === undefined ? {} : { width: `${frozen}px` }"
      @expand="canvas.expand"
      @remove="canvas.remove"
      @flush="canvas.flush"
    >
      <template #meta="{ item }"
        ><CellName
          v-if="canvas.viewCell.value === null"
          class="owner"
          :name="canvas.nameOf(item.cell)"
        />{{ clockTime(item.at) }}</template
      >
      <template #body="{ item }"><CanvasDoc :doc="item" /></template>
    </CardStream>
  </aside>
  <button
    v-if="!canvas.open.value && canvas.docs.value.length"
    v-tooltip="{ text: 'Open Canvas', keys: commandLabel('toggle-canvas') }"
    class="reopen"
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
    var(--text-4)/1.6 var(--font-ui),
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
  position: relative;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4) var(--space-2) var(--space-5);
  border-bottom: 1px solid var(--line);
  font-size: var(--text-2);
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
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.expand-all,
.collapse-all,
.close {
  padding: var(--space-1) var(--space-3);
}

.expand-all:hover,
.collapse-all:hover,
.close:hover {
  color: var(--fg);
}

.owner {
  display: inline-block;
  max-width: 18em;
  margin-right: var(--space-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}

.reopen {
  flex: none;
  writing-mode: vertical-rl;
  padding: var(--space-5) var(--space-2);
  font-size: var(--text-2);
  color: var(--muted);
}
</style>
