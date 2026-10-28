<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import type { Position } from '../config/layout'
import {
  expandPath,
  filterRecent,
  isPathInput,
  joinDir,
  matchDirs,
  pathQuery,
  pickCommand,
  stepCommand,
  type Row
} from '../launcher/query'
import { arrowIndex, closeOnFocusLoss, revealSelected } from './palette'

/** `where` 가 `cell` 이면 지금 workspace 의 새 cell 에, `workspace` 면 새 workspace 에 띄운다. */
export type Launch = { dir: string; command: string; where: 'workspace' | 'cell' }

const {
  position,
  commands,
  home = undefined
} = defineProps<{ position: Position; commands: readonly string[]; home?: string }>()
const emit = defineEmits<{ launch: [launch: Launch]; close: [] }>()

const input = useTemplateRef<HTMLInputElement>('input')
const query = ref('')
const index = ref(0)
const recent = shallowRef<readonly string[]>([])
const command = ref(commands[0])
const problem = ref<string | null>(null)
let launching = false

// `launcherState()` 의 답이 오기 전에 Tab 으로 고른 명령은 기억한 명령으로 덮지 않는다. Enter 는 이 답을 기다린 뒤 띄운다.
let picked = false
const loaded = window.maru.launcherState().then((state) => {
  recent.value = state.recent
  if (!picked) command.value = pickCommand(commands, state.command)
})
// 열린 채 `config.toml` 에서 고른 명령이 빠지면 첫 명령으로 돌아간다.
watch(
  () => commands,
  (list) => (command.value = pickCommand(list, command.value))
)

/** 경로 모드에서 마지막으로 읽은 부모 디렉토리와 그 하위 디렉토리 이름. */
const dirs = shallowRef<{ parent: string; names: string[] } | null>(null)
const path = computed(() => pathQuery(query.value, home))
let reads = 0
/** 마지막으로 청한 나열이다. Enter 는 이것을 기다린 뒤 고른다. 후보가 오기 전에 누른 Enter 가 친 경로를 그대로 열면 안 되기 때문이다. */
let listing: Promise<void> = Promise.resolve()
watch(
  () => path.value?.parent,
  (parent) => {
    const read = ++reads
    if (parent === undefined) return
    // 입력이 바뀌는 동안 늦게 온 답이 새 답을 덮지 않게 마지막으로 청한 답만 쓴다.
    listing = window.maru.listDirs(parent).then((names) => {
      if (read === reads) dirs.value = { parent, names }
    })
  },
  { immediate: true }
)

const pathMode = computed(() => isPathInput(query.value))

const rows = computed<Row[]>(() => {
  if (!pathMode.value) return filterRecent(recent.value, query.value, home)
  const q = path.value
  if (!q || dirs.value?.parent !== q.parent) return []
  return matchDirs(dirs.value.names, q.fragment).map((name) => ({
    path: joinDir(q.parent, name),
    label: q.prefix + name
  }))
})
watch(query, () => {
  index.value = 0
  problem.value = null
})
watch(command, () => (problem.value = null))
revealSelected(useTemplateRef<HTMLUListElement>('list'), index)

const empty = computed(() => {
  if (pathMode.value) return 'Enter opens the typed path'
  return recent.value.length ? 'No matching directories' : 'No recent directories'
})

const focus = (): void => input.value?.focus()
defineExpose({ focus })
onMounted(focus)
const onBlur = closeOnFocusLoss(input, () => emit('close'))

function target(): string | undefined {
  const row = rows.value[index.value]
  if (row) return row.path
  return pathMode.value ? expandPath(query.value, home) : undefined
}

async function launch(where: Launch['where'], dir = target()): Promise<void> {
  if (dir === undefined || launching) return
  launching = true
  const chosen = command.value
  try {
    const r = await window.maru.launched(dir, chosen)
    if (!r.ok) {
      problem.value = r.reason
      return
    }
    emit('launch', { dir, command: chosen, where })
  } finally {
    launching = false
  }
}

async function launchSelected(where: Launch['where']): Promise<void> {
  await nextTick()
  await Promise.all([loaded, listing])
  await launch(where)
}

async function forget(row: Row): Promise<void> {
  recent.value = (await window.maru.forgetLaunch(row.path)).recent
  index.value = Math.min(index.value, Math.max(0, rows.value.length - 1))
}

function atEnd(el: HTMLInputElement): boolean {
  return el.selectionStart === el.value.length && el.selectionEnd === el.value.length
}

function onKeydown(e: KeyboardEvent): void {
  if (e.isComposing) return
  const row = rows.value[index.value]
  const moved = arrowIndex(e.key, index.value, rows.value.length, position)
  if (moved !== undefined) index.value = moved
  else if (e.key === 'Enter') void launchSelected(e.metaKey ? 'cell' : 'workspace')
  else if (e.key === 'Backspace' && e.metaKey && row && !pathMode.value) void forget(row)
  else if (e.key === 'Tab') {
    picked = true
    command.value = stepCommand(commands, command.value, e.shiftKey ? -1 : 1)
  } else if (e.key === 'ArrowRight' && row && pathMode.value && atEnd(e.target as HTMLInputElement))
    query.value = `${row.label}/`
  else if (e.key === 'Escape') emit('close')
  else return
  e.preventDefault()
}
</script>

<template>
  <div class="palette-backdrop" :class="position" @mousedown.self.prevent="emit('close')">
    <div class="palette launcher" @mousedown="(e) => e.target !== input && e.preventDefault()">
      <div class="input-row">
        <input
          ref="input"
          v-model="query"
          class="query"
          placeholder="Filter recent directories, or type a path from ~ or /"
          spellcheck="false"
          @keydown="onKeydown"
          @blur="onBlur"
        />
        <span class="command" title="Tab: next command">{{ command }}</span>
      </div>
      <ul ref="list" class="list">
        <li v-if="problem" class="problem">{{ problem }}</li>
        <li
          v-for="(r, i) in rows"
          :key="r.path"
          class="item"
          :class="{ selected: i === index }"
          @mousemove="index = i"
          @click="(e) => launch(e.metaKey ? 'cell' : 'workspace', r.path)"
        >
          <span class="path">{{ r.label }}</span>
        </li>
        <li v-if="!rows.length" class="empty">{{ empty }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.input-row {
  display: flex;
  flex: none;
  align-items: center;
}

.input-row .query {
  flex: 1;
  min-width: 0;
  margin-right: 0;
}

.command {
  flex: none;
  max-width: 40%;
  margin: 0 6px;
  padding: 2px 6px;
  border: 1px solid var(--line);
  border-radius: 4px;
  overflow: hidden;
  color: var(--muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.problem {
  padding: 4px 12px;
  color: var(--error);
}
</style>
