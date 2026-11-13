<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'
import { GitBranch } from '@lucide/vue'
import type { Position } from '../config/layout'
import { filterSwitcher, type SwitcherRows } from '../workspace/switcherRows'
import LeadIcon from './LeadIcon.vue'
import PaneIcon from './PaneIcon.vue'
import { arrowIndex, closeOnFocusLoss, revealSelected } from './palette'

/**
 * ⌘P 전환기다. pane 줄과 디렉토리 줄을 한 목록으로 이어 붙여, 화살표는 두 묶음을 건너 움직인다. 묶음 이름 줄은 고를 수
 * 없다. 아래 팔레트는 목록을 column-reverse 로 그리므로, 묶음 이름 줄을 DOM 에서 묶음 뒤에 두어야 화면에서 묶음 위에 온다.
 */
const { position, rows } = defineProps<{ position: Position; rows: SwitcherRows }>()
const emit = defineEmits<{
  pane: [cell: number, pane: number]
  dir: [workspace: number, dir: string]
  close: []
}>()

const input = useTemplateRef<HTMLInputElement>('input')
const query = ref('')
const index = ref(0)
const matches = computed(() => filterSwitcher(rows, query.value))
const count = computed(() => matches.value.panes.length + matches.value.dirs.length)
watch(query, () => (index.value = 0))
revealSelected(useTemplateRef<HTMLUListElement>('list'), index)

const focus = (): void => input.value?.focus()
defineExpose({ focus })
onMounted(focus)
const onBlur = closeOnFocusLoss(input, () => emit('close'))

function pick(i: number): void {
  const { panes, dirs } = matches.value
  const p = panes[i]
  if (p) return emit('pane', p.cell, p.pane)
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

const headLast = computed(() => position === 'bottom')
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
        <li v-if="matches.panes.length && !headLast" class="head workspace-title">Panes</li>
        <li
          v-for="(r, i) in matches.panes"
          :key="`pane:${r.pane}`"
          class="item pane-item"
          :class="[r.tone, { selected: i === index, current: r.focused }]"
          :aria-label="r.aria"
          :aria-current="r.focused || undefined"
          @mousemove="index = i"
          @click="pick(i)"
        >
          <span class="main"
            ><span class="state status-icon" :class="{ unread: r.notice }"
              ><PaneIcon :icon="r.icon" /></span
            ><span class="title">{{ r.name }}</span
            ><span v-if="r.place" class="place"
              ><span v-if="r.place.name">{{ r.place.name }}</span
              ><span v-if="r.place.branch" class="branch"
                ><GitBranch class="text-icon" /><span class="branch-name">{{
                  r.place.branch
                }}</span></span
              ><span v-if="r.place.sub" class="sub">· {{ r.place.sub }}</span></span
            ></span
          >
          <span class="where"
            ><span v-if="r.focused" class="current-label">Current</span>{{ r.workspaceName }}</span
          >
        </li>
        <li v-if="matches.panes.length && headLast" class="head workspace-title">Panes</li>
        <li v-if="matches.dirs.length && !headLast" class="head workspace-title">Favorites</li>
        <li
          v-for="(d, i) in matches.dirs"
          :key="`dir:${d.workspace}:${d.dir}`"
          class="item dir-item"
          :class="{ selected: i + matches.panes.length === index }"
          @mousemove="index = i + matches.panes.length"
          @click="pick(i + matches.panes.length)"
        >
          <span class="main"
            ><span class="state"><LeadIcon :name="d.root ? 'folder-root' : 'folder'" /></span
            ><span class="title">{{ d.name }}</span
            ><span class="place">{{ d.path }}</span></span
          >
          <span class="where">{{ d.workspaceName }}</span>
        </li>
        <li v-if="matches.dirs.length && headLast" class="head workspace-title">Favorites</li>
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

.place {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: var(--text-1);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.branch {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}

.branch-name {
  overflow: hidden;
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
