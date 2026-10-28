<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch
} from 'vue'
import type { Position } from '../config/layout'
import { commandArgv } from '../config/launcher'
import { ICONS, programIcon } from '../icons'
import {
  expandPath,
  filterRecent,
  isPathInput,
  joinDir,
  matchDirs,
  pathQuery,
  pickCommand,
  type Row
} from '../launcher/query'
import { SHELL } from '../../../shared/launcher'
import { matchesWords } from '../../../shared/commands'
import { arrowIndex, closeOnFocusLoss, revealSelected } from './palette'

export type Launch = { dir: string; command: string; where: 'workspace' | 'cell' }

const {
  position,
  commands,
  home = undefined
} = defineProps<{
  position: Position
  commands: readonly string[]
  home?: string
}>()
const emit = defineEmits<{ launch: [launch: Launch]; close: [] }>()

const input = useTemplateRef<HTMLInputElement>('input')
const query = ref('')
const recent = shallowRef<readonly string[]>([])
/** 마지막으로 띄운 명령. 명령 단계에서 처음 고르는 행이다. */
const command = ref(commands[0])
const problem = ref<string | null>(null)
let launching = false

const loaded = window.maru.launcherState().then((state) => {
  recent.value = state.recent
  command.value = pickCommand(commands, state.command)
})
watch(
  () => commands,
  (list) => (command.value = pickCommand(list, command.value))
)

/** 디렉토리를 고른 뒤의 명령 단계. `query` 는 돌아갈 때 되살릴 디렉토리 단계의 입력이다. */
const chosen = shallowRef<{ dir: string; label: string; query: string } | null>(null)

const dirs = shallowRef<{ parent: string; names: string[] } | null>(null)
const path = computed(() => pathQuery(query.value, home))
let reads = 0
/** 마지막으로 요청한 하위 디렉토리 목록이다. Enter 는 이 목록이 온 뒤에 고른다. 목록이 오기 전에 누른 Enter 가 친 경로를 그대로 열면 안 되기 때문이다. */
let listing: Promise<void> = Promise.resolve()
watch(
  () => path.value?.parent,
  (parent) => {
    const read = ++reads
    if (parent === undefined) return
    // 입력이 바뀌는 동안 늦게 온 답이 새 답을 덮지 않게 마지막 요청의 답만 쓴다.
    listing = window.maru.listDirs(parent).then((names) => {
      if (read === reads) dirs.value = { parent, names }
    })
  },
  { immediate: true }
)

const pathMode = computed(() => !chosen.value && isPathInput(query.value))

const commandRows = computed(() =>
  [
    ...commands.map((c) => ({
      command: c,
      label: c,
      icon: programIcon(commandArgv(c)[0]) ?? ICONS.running
    })),
    { command: SHELL, label: 'shell', icon: ICONS.terminal }
  ].filter((r) => matchesWords(r.label, query.value))
)

const rows = computed<Row[]>(() => {
  if (!pathMode.value) return filterRecent(recent.value, query.value, home)
  const q = path.value
  if (!q || dirs.value?.parent !== q.parent) return []
  return matchDirs(dirs.value.names, q.fragment).map((name) => ({
    path: joinDir(q.parent, name),
    label: q.prefix + name
  }))
})
// `/` 로 끝난 경로는 그 디렉토리를 다 친 것이므로 후보를 고르지 않고(-1) Enter 가 친 경로를 연다. 셸에서 `cd ~/a/` 를
// 치고 Enter 를 누르면 `~/a` 로 가는 것과 같다.
function initialIndex(): number {
  if (chosen.value)
    return query.value
      ? 0
      : Math.max(
          0,
          commandRows.value.findIndex((r) => r.command === command.value)
        )
  return path.value?.fragment === '' ? -1 : 0
}
const index = ref(initialIndex())
watch([query, chosen], () => {
  index.value = initialIndex()
  problem.value = null
})
revealSelected(useTemplateRef<HTMLUListElement>('list'), index)

const count = computed(() => (chosen.value ? commandRows.value.length : rows.value.length))

const empty = computed(() => {
  if (chosen.value) return 'No matching commands'
  if (pathMode.value) return 'Enter opens the typed path'
  return recent.value.length ? 'No matching directories' : 'No recent directories'
})

const section = computed(() => {
  if (chosen.value) return chosen.value.label
  return pathMode.value ? 'Open directory' : 'Recent'
})

const focus = (): void => input.value?.focus()
defineExpose({ focus })
onMounted(focus)
const onBlur = closeOnFocusLoss(input, () => emit('close'))

function target(): Row | undefined {
  const row = rows.value[index.value]
  if (row) return row
  return pathMode.value ? { path: expandPath(query.value, home), label: query.value } : undefined
}

async function launch(dir: string, cmd: string, cell: boolean): Promise<void> {
  if (launching) return
  launching = true
  try {
    const r = await window.maru.launched(dir, cmd)
    if (!r.ok) {
      problem.value = r.reason
      return
    }
    emit('launch', { dir, command: cmd, where: cell ? 'cell' : 'workspace' })
  } finally {
    launching = false
  }
}

/** `given` 을 주지 않으면 최근 목록과 하위 디렉토리 목록이 온 뒤의 선택으로 고른다. 그 전에 고르면 아직 오지 않은 후보를 빠뜨린다. */
async function choose(given?: Row): Promise<void> {
  await nextTick()
  await Promise.all([loaded, listing])
  // 기다리는 동안 누른 Enter·클릭이 먼저 명령 단계로 넘겼으면, 그 사이 바뀐 목록에서 다시 고르지 않는다.
  if (chosen.value) return
  const row = given ?? target()
  if (row === undefined) return
  chosen.value = { dir: row.path, label: row.label.replace(/(?<=.)\/+$/, ''), query: query.value }
  query.value = ''
}

function back(): void {
  const c = chosen.value
  if (!c) return
  chosen.value = null
  query.value = c.query
}

function enter(cell: boolean): void {
  const c = chosen.value
  if (!c) {
    void choose()
    return
  }
  const row = commandRows.value[index.value]
  if (row) void launch(c.dir, row.command, cell)
}

const meta = ref(false)
const resetMeta = (): void => {
  meta.value = false
}
// ⌘ 를 쥔 채 창을 떠나면 keyup 이 오지 않는다.
onMounted(() => window.addEventListener('blur', resetMeta))
onUnmounted(() => window.removeEventListener('blur', resetMeta))

async function forget(row: Row): Promise<void> {
  recent.value = (await window.maru.forgetLaunch(row.path)).recent
  index.value = Math.min(index.value, Math.max(0, rows.value.length - 1))
}

function atEnd(el: HTMLInputElement): boolean {
  return el.selectionStart === el.value.length && el.selectionEnd === el.value.length
}

function onKeydown(e: KeyboardEvent): void {
  meta.value = e.metaKey
  if (e.isComposing) return
  const row = chosen.value ? undefined : rows.value[index.value]
  const n = count.value
  const moved = arrowIndex(e.key, index.value, n, position)
  // 아무것도 고르지 않았을 때는 화면에서 입력줄 쪽 끝이 출발점이라, 다음 후보 쪽 화살표는 첫 후보로 간다.
  if (moved !== undefined && index.value < 0)
    index.value = (e.key === 'ArrowDown') === (position === 'top') ? 0 : n - 1
  else if (moved !== undefined) index.value = moved
  else if (e.key === 'Enter') enter(e.metaKey)
  // ⌘⌫ 는 입력창에서 커서 앞을 줄 처음까지 지우는 키라, 최근 목록의 행 지우기는 ⇧⌘⌫ 에 둔다.
  else if (e.key === 'Backspace' && e.metaKey && e.shiftKey && row && !pathMode.value)
    void forget(row)
  else if (e.key === 'Backspace' && chosen.value && query.value === '') back()
  else if (e.key === 'Tab') {
    if (row) query.value = `${row.label}/`
  } else if (e.key === 'ArrowRight' && row && pathMode.value && atEnd(e.target as HTMLInputElement))
    query.value = `${row.label}/`
  else if (e.key === 'Escape') {
    if (chosen.value) back()
    else emit('close')
  } else return
  e.preventDefault()
}
</script>

<template>
  <div class="palette-backdrop" :class="position" @mousedown.self.prevent="emit('close')">
    <div class="palette launcher" @mousedown="(e) => e.target !== input && e.preventDefault()">
      <input
        ref="input"
        v-model="query"
        class="query"
        :placeholder="
          chosen ? 'Choose a command' : 'Filter recent directories, or type a path from ~ or /'
        "
        spellcheck="false"
        @keydown="onKeydown"
        @keyup="(e) => (meta = e.metaKey)"
        @blur="onBlur"
      />
      <ul v-if="chosen" ref="list" class="list">
        <li v-if="problem" class="problem">{{ problem }}</li>
        <li
          v-for="(r, i) in commandRows"
          :key="r.command"
          class="item"
          :class="{ selected: i === index }"
          @mousemove="index = i"
          @click="(e) => launch(chosen!.dir, r.command, e.metaKey)"
        >
          <span class="program"
            ><span class="program-icon nerd-icon">{{ r.icon }}</span
            ><span class="path">{{ r.label }}</span></span
          >
        </li>
        <li v-if="!commandRows.length" class="empty">{{ empty }}</li>
      </ul>
      <ul v-else ref="list" class="list">
        <li v-if="problem" class="problem">{{ problem }}</li>
        <li
          v-for="(r, i) in rows"
          :key="r.path"
          class="item"
          :class="{ selected: i === index }"
          @mousemove="index = i"
          @click="choose(r)"
        >
          <span class="path">{{ r.label }}</span>
          <button
            v-if="!pathMode"
            class="remove nerd-icon"
            title="Remove from recent (⇧⌘⌫)"
            aria-label="Remove from recent"
            @click.stop="forget(r)"
          >
            {{ ICONS.close }}
          </button>
        </li>
        <li v-if="!rows.length" class="empty">{{ empty }}</li>
      </ul>
      <div class="section">
        <span class="path" :class="{ label: !chosen }">{{ section }}</span>
        <span v-if="chosen" class="where">{{ meta ? 'New Cell' : 'New Workspace' }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.program {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.program-icon {
  flex: none;
  width: 16px;
  color: var(--muted);
  font-size: 14px;
  text-align: center;
}

.section {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex: none;
  padding: 6px 12px 5px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
}

/* 아래 팔레트는 column-reverse 라 DOM 순서대로 헤더가 목록 위에 놓인다. 위 팔레트는 입력줄과 목록 사이로 옮긴다. */
.top .section {
  order: 1;
  padding: 0 12px 5px;
}

.top .list {
  order: 2;
  padding: 4px 0 6px;
}

/* 명령 단계의 헤더는 디렉토리 경로라, 대소문자를 바꾸면 다른 경로로 읽힌다. */
.label {
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.where {
  flex: none;
  font-weight: normal;
}

.remove {
  flex: none;
  visibility: hidden;
  margin: 0 -4px 0 8px;
  padding: 0 4px;
  border: none;
  background: none;
  color: var(--muted);
  font-size: 10px;
  line-height: inherit;
  cursor: pointer;
}

.item:hover .remove {
  visibility: visible;
}

.remove:hover {
  color: var(--fg);
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
