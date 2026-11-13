<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'
import type { Position } from '../config/layout'
import { filterSwitcher, switcherItems, type SwitcherRows } from '../workspace/switcherRows'
import LeadIcon from './LeadIcon.vue'
import PaneIcon from './PaneIcon.vue'
import PanePlace from './PanePlace.vue'
import { arrowIndex, closeOnFocusLoss, revealSelected } from './palette'

const { position, rows } = defineProps<{ position: Position; rows: SwitcherRows }>()
const emit = defineEmits<{
  pane: [workspace: number, cell: number, pane: number]
  dir: [workspace: number, dir: string]
  close: []
}>()

const input = useTemplateRef<HTMLInputElement>('input')
const query = ref('')
const index = ref(0)
const matches = computed(() => filterSwitcher(rows, query.value))
const count = computed(() => matches.value.panes.length + matches.value.dirs.length)
watch(query, () => (index.value = 0))
// 떠 있는 동안 pane 이 닫혀 줄이 줄면 선택이 목록 밖에 남으므로 마지막 줄로 당긴다.
watch(count, (n) => (index.value = Math.min(index.value, Math.max(n - 1, 0))))
revealSelected(useTemplateRef<HTMLUListElement>('list'), index)

const focus = (): void => input.value?.focus()
defineExpose({ focus })
onMounted(focus)
const onBlur = closeOnFocusLoss(input, () => emit('close'))

function pick(i: number): void {
  const { panes, dirs } = matches.value
  const p = panes[i]
  if (p) return emit('pane', p.workspace, p.cell, p.pane)
  const d = dirs[i - panes.length]
  if (d) emit('dir', d.workspace, d.dir)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.isComposing) return
  const moved = arrowIndex(e.key, index.value, count.value, position)
  if (moved !== undefined) index.value = moved
  else if (e.key === 'Enter') pick(index.value)
  // Tab 을 브라우저에 맡기면 포커스가 사이드바의 버튼으로 옮겨 가, 닫으며 돌려준 터미널의 포커스를 빼앗는다.
  else if (e.key === 'Escape' || e.key === 'Tab') emit('close')
  else return
  e.preventDefault()
}

const items = computed(() => switcherItems(matches.value, position === 'bottom'))
</script>

<template>
  <div class="palette-backdrop" :class="position" @mousedown.self.prevent="emit('close')">
    <div class="palette switcher" @mousedown="(e) => e.target !== input && e.preventDefault()">
      <input
        ref="input"
        v-model="query"
        class="query text-input"
        placeholder="Go to a pane or open a favorite"
        spellcheck="false"
        @keydown="onKeydown"
        @blur="onBlur"
      />
      <ul ref="list" v-overlay-scroll="'y'" class="list">
        <template v-for="it in items" :key="it.key">
          <li v-if="it.kind === 'head'" class="head workspace-title">{{ it.title }}</li>
          <li
            v-else-if="it.kind === 'pane'"
            class="item pane-item"
            :class="[it.row.tone, { selected: it.i === index }]"
            :aria-label="it.row.aria"
            :aria-current="it.row.focused || undefined"
            @mousemove="index = it.i"
            @click="pick(it.i)"
          >
            <span class="main"
              ><span class="state status-icon" :class="{ unread: it.row.notice }"
                ><PaneIcon :icon="it.row.icon" /></span
              ><span class="title">{{ it.row.name }}</span
              ><PanePlace v-if="it.row.place" class="tail" :place="it.row.place"
            /></span>
            <span class="where"
              ><span v-if="it.row.focused" class="current-label">Current</span
              >{{ it.row.workspaceName }}</span
            >
          </li>
          <li
            v-else
            class="item dir-item"
            :class="{ selected: it.i === index }"
            @mousemove="index = it.i"
            @click="pick(it.i)"
          >
            <span class="main"
              ><span class="state"><LeadIcon :name="it.row.root ? 'folder-root' : 'folder'" /></span
              ><span class="title">{{ it.row.name }}</span
              ><span class="tail path">{{ it.row.path }}</span></span
            >
            <span class="where">{{ it.row.workspaceName }}</span>
          </li>
        </template>
        <li v-if="!count" class="empty">No matching panes or favorites</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.item {
  align-items: center;
  gap: var(--space-5);
}

.main {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
}

.state {
  display: flex;
  justify-content: center;
  flex: none;
  width: 14px;
  color: var(--claude, var(--faint));
  --unread-ring: var(--raised);
}

.dir-item .state {
  color: var(--muted);
}

.title {
  flex: none;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tail {
  min-width: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: var(--text-1);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.where {
  flex: none;
  max-width: 35%;
  overflow: hidden;
  color: var(--muted);
  font-size: var(--text-1);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.current-label {
  margin-right: var(--space-4);
  color: var(--accent);
}

.head {
  padding: var(--space-3) var(--space-5) var(--space-2);
  color: var(--muted);
}
</style>
