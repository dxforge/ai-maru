<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import type { Canvas, CanvasView, CellChoice } from '../canvas/store'
import { ICONS } from '../icons'
import CellName from './CellName.vue'
import FoldChevron from './FoldChevron.vue'

const { canvas } = defineProps<{ canvas: Canvas }>()

const root = useTemplateRef<HTMLElement>('root')
const opened = ref(false)

const keyOf = (v: CanvasView): string => (typeof v === 'string' ? v : `cell:${v.cell}`)

type Item = { view: CanvasView; text?: string; choice?: CellChoice }
const items = computed((): Item[] => [
  { view: 'current', text: 'Current cell' },
  { view: 'all', text: 'All documents' },
  ...canvas.choices.value.map((c) => ({ view: { cell: c.id }, choice: c }))
])

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
      <span class="label">
        <template v-if="canvas.viewCell.value === null">All documents</template>
        <template v-else-if="canvas.viewCell.value"
          ><CellName :name="canvas.nameOf(canvas.viewCell.value)" /><template
            v-if="canvas.isClosed(canvas.viewCell.value)"
          >
            <span class="closed">closed</span></template
          ></template
        >
        <template v-else>Current cell</template>
      </span>
      <FoldChevron class="chev" :open="true" />
    </button>
    <div v-if="opened" v-overlay-scroll="'y'" class="menu popup-menu" role="menu">
      <template v-for="(it, i) in items" :key="keyOf(it.view)">
        <hr v-if="i === 2" />
        <button
          :class="typeof it.view === 'string' ? it.view : undefined"
          :data-cell="it.choice?.id"
          role="menuitemradio"
          :aria-checked="keyOf(it.view) === keyOf(canvas.view.value)"
          @mousedown.prevent
          @click="choose(it.view)"
        >
          <span class="check nerd-icon">{{
            keyOf(it.view) === keyOf(canvas.view.value) ? ICONS.check : ''
          }}</span
          ><template v-if="it.choice"
            ><CellName class="label" :name="it.choice.name" /><span
              v-if="it.choice.closed"
              class="closed"
              >closed</span
            ></template
          ><template v-else>{{ it.text }}</template>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.views {
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
  max-width: 100%;
  padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3);
  border-radius: var(--radius-1);
  color: var(--fg);
}

.view:hover,
.view.opened {
  background: var(--hover);
}

.label {
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
