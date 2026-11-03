<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import type { Canvas, CanvasView } from '../canvas/store'
import { ICONS } from '../icons'
import CellName from './CellName.vue'
import FoldChevron from './FoldChevron.vue'

const { canvas } = defineProps<{ canvas: Canvas }>()

const root = useTemplateRef<HTMLElement>('root')
const opened = ref(false)

const keyOf = (v: CanvasView): string => (typeof v === 'string' ? v : `cell:${v.cell}`)
const checked = (v: CanvasView): boolean => keyOf(v) === keyOf(canvas.view.value)

const fixed = [
  { view: 'current', text: 'Current cell' },
  { view: 'all', text: 'All documents' }
] as const

function choose(v: CanvasView): void {
  canvas.choose(v)
  opened.value = false
}

watch(
  () => canvas.open.value,
  (open) => {
    if (!open) opened.value = false
  }
)

function closeOutside(e: PointerEvent): void {
  const t = e.target as Node | null
  if (!(t && root.value?.contains(t))) opened.value = false
}

onMounted(() => document.addEventListener('pointerdown', closeOutside, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeOutside, true))
</script>

<template>
  <div ref="root" class="views">
    <button
      class="view"
      :class="{ opened }"
      :aria-expanded="opened"
      @mousedown.prevent
      @click="opened = !opened"
    >
      <span v-if="canvas.viewCell.value === null" class="label">All documents</span>
      <template v-else-if="canvas.viewCell.value"
        ><CellName class="label" :name="canvas.nameOf(canvas.viewCell.value)" /><span
          v-if="canvas.isClosed(canvas.viewCell.value)"
          class="closed"
          >closed</span
        ></template
      >
      <span v-else class="label">Current cell</span>
      <FoldChevron class="chev" :open="true" />
    </button>
    <div v-if="opened" v-overlay-scroll="'y'" class="menu popup-menu" role="menu">
      <button
        v-for="it in fixed"
        :key="it.view"
        :class="it.view"
        role="menuitemradio"
        :aria-checked="checked(it.view)"
        @mousedown.prevent
        @click="choose(it.view)"
      >
        <span class="check nerd-icon">{{ checked(it.view) ? ICONS.check : '' }}</span
        >{{ it.text }}
      </button>
      <hr v-if="canvas.choices.value.length" />
      <div v-for="g in canvas.choices.value" :key="g.id" class="group" role="group">
        <div class="group-name workspace-title">{{ g.workspace }}</div>
        <button
          v-for="c in g.cells"
          :key="c.id"
          :data-cell="c.id"
          role="menuitemradio"
          :aria-checked="checked({ cell: c.id })"
          @mousedown.prevent
          @click="choose({ cell: c.id })"
        >
          <span class="check nerd-icon">{{ checked({ cell: c.id }) ? ICONS.check : '' }}</span
          ><CellName class="label" :name="c.name" /><span v-if="c.closed" class="closed"
            >closed</span
          >
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.views {
  flex: 1;
  min-width: 0;
  -webkit-app-region: no-drag;
}

button {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  cursor: pointer;
}

.view {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3);
  border-radius: var(--radius-1);
  color: var(--fg);
}

.view:hover,
.view.opened {
  background: var(--hover);
}

.label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chev,
.closed {
  flex: none;
  color: var(--faint);
}

/* `FoldChevron` 은 열리면 아래를 가리키므로, 목록이 열린 동안 반 바퀴 더 돌려 위를 가리킨다. 회전 트랜지션은 `FoldChevron` 의 것을 쓴다. */
.view.opened .chev {
  transform: rotate(-90deg);
}

.closed {
  margin-left: var(--space-2);
}

.menu {
  position: absolute;
  top: calc(100% + var(--space-1));
  left: var(--space-3);
  right: var(--space-3);
  z-index: 4;
  max-height: 60vh;
}

.menu button {
  display: flex;
  align-items: center;
  padding-left: var(--space-3);
}

.group-name {
  padding: var(--space-3) var(--space-5) var(--space-1) var(--space-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--faint);
}

.check {
  flex: none;
  width: 1.5em;
  color: var(--accent);
}

hr {
  margin: var(--space-2) 0;
  border: none;
  border-top: 1px solid var(--line);
}
</style>
