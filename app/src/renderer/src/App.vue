<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, useTemplateRef, watch } from 'vue'
import type { CommandId } from '../../shared/commands'
import { createCanvas } from './canvas/store'
import { createClaudeStatuses } from './claude/status'
import CanvasPanel from './components/CanvasPanel.vue'
import CommandPalette from './components/CommandPalette.vue'
import PaneHeader from './components/PaneHeader.vue'
import TerminalView from './components/TerminalView.vue'
import { FONT_FAMILY, FONT_SIZE } from './font'
import { ICONS } from './icons'
import { columnsWidth, terminalPadding } from './workspace/columns'
import { workspaceName } from './workspace/cwd'
import { snapRects, type Box, type Size } from './workspace/grid'
import { columnCount, rects, type Rect } from './workspace/layout'
import { createWorkspaces, focusedPane } from './workspace/store'

const canvas = createCanvas()
window.maru.onCanvasPut(canvas.put)

const workspaces = createWorkspaces()

const claude = createClaudeStatuses()
window.maru.onClaudeStatus(claude.set)
void window.maru.claudeStatuses().then(claude.replace)
function newWorkspace(): void {
  const w = workspaces.selected()
  const p = w && focusedPane(w)
  workspaces.open(p?.cwd ?? p?.startDir)
}
workspaces.open()

type Terminal = InstanceType<typeof TerminalView>
const terminals = new Map<number, Terminal>()
function setTerminal(key: number, t: unknown): void {
  if (t) terminals.set(key, t as Terminal)
  else terminals.delete(key)
}

// 보이지 않는 터미널에는 포커스를 줄 수 없어, 선택이 화면에 반영된 뒤에 준다.
async function focusSelected(): Promise<void> {
  await nextTick()
  const w = workspaces.selected()
  if (w) terminals.get(w.focused)?.focus()
}

// 선택이 그대로인 클릭에서는 TerminalView 의 active watch 와 아래의 스크롤 watch 가 돌지 않아,
// 여기서 포커스를 주고 스크롤로 밀려난 칸을 다시 보인다.
function selectWorkspace(key: number): void {
  workspaces.select(key)
  void focusSelected().then(revealFocused)
}

function stepWorkspace(by: 1 | -1): void {
  const key = workspaces.step(by)
  if (key !== undefined) selectWorkspace(key)
}

function closePane(): void {
  const w = workspaces.selected()
  if (!w) return
  const pane = w.focused
  terminals.get(pane)?.kill()
  workspaces.closePane(pane)
  void focusSelected()
}

const sidebarOpen = ref(true)
const viewMode = ref<'single' | 'columns'>('single')
// 모든 터미널이 같은 글꼴을 쓰므로 마지막으로 잰 값 하나로 셈한다.
const cell = ref<Size>({ width: 0, height: 0 })
const FALLBACK_ROW = 18
const row = computed(() => cell.value.height || FALLBACK_ROW)
const gridVars = computed(() => ({
  '--row': `${row.value}px`,
  '--cell': `${cell.value.width}px`,
  '--pad': `${terminalPadding(cell.value.width)}px`,
  '--font-size': `${FONT_SIZE}px`,
  '--font-family': FONT_FAMILY
}))

/** workspace 마다 칸이 놓이는 영역의 크기. CSS 가 정하는 머리·여백을 JS 에서 다시 셈하지 않게 잰다. */
const gridSizes = reactive(new Map<number, Size>())
const gridEls = new Map<number, Element>()
const gridKeys = new WeakMap<Element, number>()
const gridObserver = new ResizeObserver((entries) => {
  for (const { target, contentRect } of entries) {
    const key = gridKeys.get(target)
    if (key !== undefined)
      gridSizes.set(key, { width: contentRect.width, height: contentRect.height })
  }
})
function observeGrid(key: number, el: unknown): void {
  const old = gridEls.get(key)
  if (old === el) return
  if (old) gridObserver.unobserve(old)
  if (el instanceof Element) {
    gridEls.set(key, el)
    gridKeys.set(el, key)
    gridObserver.observe(el)
  } else {
    gridEls.delete(key)
    gridSizes.delete(key)
  }
}
onBeforeUnmount(() => gridObserver.disconnect())

function setCell(c: Size): void {
  if (c.width !== cell.value.width || c.height !== cell.value.height) cell.value = c
}

function paneStyle(b: Box, size: Size) {
  const bottom = b.top + b.height < size.height
  return {
    style: {
      left: `${b.left}px`,
      top: `${b.top}px`,
      width: `${b.width}px`,
      height: `${b.height}px`
    },
    // FitAddon 은 높이를 정수로 잘라 읽고, 지금 행 수로 반올림한 셀 높이로 나눠 행의 배수인 높이에서
    // 한 행을 잃곤 한다. 아래에 칸이 있는 칸은 터미널을 반 행 더 내리고 넘친 부분은 칸이 가린다.
    body: bottom ? { height: `${b.height - row.value / 2}px` } : { bottom: '0' },
    edges: { 'edge-left': b.left > 0, 'edge-top': b.top > 0 }
  }
}

/** 영역을 재기 전의 첫 렌더. 0×0 으로 그리면 터미널이 그 크기로 세션을 연다. */
function unmeasuredStyle(r: Rect) {
  return {
    style: {
      left: `${r.x * 100}%`,
      top: `${r.y * 100}%`,
      width: `${r.w * 100}%`,
      height: `${r.h * 100}%`
    },
    body: { bottom: '0' },
    edges: { 'edge-left': r.x > 0, 'edge-top': r.y > 0 }
  }
}

const views = computed(() =>
  workspaces.list.value.map((w) => {
    const selected = w.key === workspaces.selectedKey.value
    const measured = gridSizes.get(w.key)
    const size =
      viewMode.value === 'columns'
        ? {
            width: columnsWidth(columnCount(w.layout), cell.value.width),
            height: measured?.height ?? 0
          }
        : (measured ?? { width: 0, height: 0 })
    const boxes = snapRects(w.layout, size, cell.value)
    const fractions = rects(w.layout)
    return {
      w,
      selected,
      focused: focusedPane(w),
      width: viewMode.value === 'columns' ? `${size.width}px` : undefined,
      panes: w.panes.map((p) => ({
        p,
        active: selected && p.key === w.focused,
        ...(measured ? paneStyle(boxes.get(p.key)!, size) : unmeasuredStyle(fractions.get(p.key)!))
      }))
    }
  })
)

const URGENCY = ['waiting', 'working', 'idle'] as const

const urgent = computed(() => {
  const map = new Map<number, (typeof URGENCY)[number]>()
  if (viewMode.value !== 'columns') return map
  for (const w of workspaces.list.value) {
    const states = new Set(w.panes.map((p) => claude.state(p.sessionId)))
    const state = URGENCY.find((s) => states.has(s))
    if (state) map.set(w.key, state)
  }
  return map
})

// columns 에서는 다른 workspace 의 칸도 보여 눌러 포커스를 줄 수 있으므로, 그 workspace 를 선택한다.
function focusPane(workspace: number, pane: number): void {
  workspaces.focusPane(pane)
  workspaces.select(workspace)
}

// workspace 가 화면보다 넓을 수 있어, workspace 가 아니라 포커스된 칸이 보이게 한다.
function revealFocused(): void {
  const w = workspaces.selected()
  if (viewMode.value === 'columns' && w)
    terminals.get(w.focused)?.$el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
// 포커스가 그대로여도 앞의 workspace 가 닫히거나 폭이 바뀌면 칸이 밀려나 views 도 지켜본다.
watch([viewMode, () => workspaces.selected()?.focused, views], revealFocused, { flush: 'post' })

const paletteOpen = ref(false)
const palette = useTemplateRef<InstanceType<typeof CommandPalette>>('palette')

function closePalette(): void {
  if (!paletteOpen.value) return
  paletteOpen.value = false
  void focusSelected()
}

const handlers: Record<CommandId, () => void> = {
  'new-workspace': newWorkspace,
  'split-right': () => workspaces.split('right'),
  'split-down': () => workspaces.split('down'),
  'close-pane': closePane,
  'next-workspace': () => stepWorkspace(1),
  'previous-workspace': () => stepWorkspace(-1),
  'focus-pane-left': () => workspaces.moveFocus('left'),
  'focus-pane-right': () => workspaces.moveFocus('right'),
  'focus-pane-up': () => workspaces.moveFocus('up'),
  'focus-pane-down': () => workspaces.moveFocus('down'),
  'command-palette': () => {
    paletteOpen.value = true
    palette.value?.focus()
  },
  'toggle-sidebar': () => {
    sidebarOpen.value = !sidebarOpen.value
  },
  'toggle-canvas': canvas.toggle,
  'toggle-view-mode': () => {
    viewMode.value = viewMode.value === 'single' ? 'columns' : 'single'
  }
}

function runCommand(id: CommandId): void {
  if (id !== 'command-palette') closePalette()
  handlers[id]()
}
window.maru.onCommand(runCommand)
</script>

<template>
  <div class="app" :style="gridVars">
    <nav v-show="sidebarOpen" class="sidebar">
      <button
        v-for="{ w, selected, focused } in views"
        :key="w.key"
        class="workspace"
        :class="{ selected }"
        @mousedown.prevent
        @click="selectWorkspace(w.key)"
      >
        <span
          v-if="claude.state(focused.sessionId)"
          class="claude-dot"
          :class="claude.state(focused.sessionId)"
          :title="`Claude: ${claude.state(focused.sessionId)}`"
        />{{ workspaceName(focused.cwd) }}
      </button>
    </nav>
    <div class="terminals" :class="viewMode">
      <div
        v-for="{ w, selected, focused, width, panes } in views"
        :key="w.key"
        class="panes"
        :class="{ selected }"
        :style="{ width }"
      >
        <div
          v-if="viewMode === 'columns'"
          class="bar workspace-header"
          :class="[urgent.get(w.key), { focused: selected }]"
          @mousedown.prevent="selectWorkspace(w.key)"
        >
          <span class="bar-icon">{{ urgent.has(w.key) ? ICONS[urgent.get(w.key)!] : '' }}</span>
          <span class="name">{{ workspaceName(focused.cwd) }}</span>
        </div>
        <div :ref="(el) => observeGrid(w.key, el)" class="grid">
          <div
            v-for="{ p, active, style, body, edges } in panes"
            :key="p.key"
            class="pane"
            :class="[edges, { focused: active }]"
            :style="style"
            @focusin="focusPane(w.key, p.key)"
          >
            <PaneHeader
              :state="claude.state(p.sessionId)"
              :title="p.title"
              :cwd="p.cwd"
              :focused="active"
              @mousedown.prevent="terminals.get(p.key)?.focus()"
            />
            <div class="body" :style="body">
              <TerminalView
                :ref="(t) => setTerminal(p.key, t)"
                :start-dir="p.startDir"
                :active="active"
                @exit="workspaces.closePane(p.key)"
                @spawned="(id) => workspaces.setSessionId(p.key, id)"
                @cwd="(dir) => workspaces.setCwd(p.key, dir)"
                @title="(title) => workspaces.setTitle(p.key, title)"
                @cell="setCell"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
    <CanvasPanel :canvas="canvas" />
    <CommandPalette v-if="paletteOpen" ref="palette" @run="runCommand" @close="closePalette" />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  height: 100%;
}

.sidebar {
  flex: 0 0 140px;
  display: flex;
  flex-direction: column;
  padding: 4px;
  border-right: 1px solid var(--line);
  background: var(--side);
  overflow-y: auto;
}

.workspace {
  padding: 4px 8px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--muted);
  font:
    13px system-ui,
    sans-serif;
  text-align: left;
  cursor: pointer;
}

.workspace:hover {
  background: var(--hover);
}

.workspace.selected {
  background: var(--selected);
  color: var(--fg);
}

.claude-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--claude);
  vertical-align: middle;
}

.terminals {
  position: relative;
  flex: 1;
  min-width: 0;
}

/* 보이지 않는 터미널도 자리를 차지해야 창 크기를 따라가고, 보일 때 다시 맞추지 않아도 된다. */
.panes {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  visibility: hidden;
}

.panes.selected {
  visibility: visible;
}

.grid {
  position: relative;
  flex: 1;
  min-height: 0;
}

/* workspace 사이는 행 격자를 이어 쓸 필요가 없어, 틈을 두고 카드로 나눈다. */
.columns {
  display: flex;
  gap: 8px;
  padding: 8px 8px 0;
  background: var(--side);
  /* 스크롤바가 자리를 차지하는 설정에서, 넘치기 시작하거나 그칠 때마다 터미널의 줄 수가 바뀌지 않게. */
  overflow-x: scroll;
}

.columns .panes {
  position: relative;
  flex: none;
  border-radius: 6px 6px 0 0;
  overflow: clip;
  visibility: visible;
}

.columns .panes.selected {
  box-shadow: 0 0 0 1px var(--muted);
}

.workspace-header {
  flex: none;
}

.workspace-header .name {
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
}

.pane {
  position: absolute;
  /* 다른 클라이언트가 primary 면 fit 하지 않아, 터미널이 칸보다 넓으면 옆 칸과 패널을 덮는다.
     hidden 이면 칸이 스크롤 영역이 되어, 칸보다 큰 터미널을 scrollIntoView 할 때 머리가 밀려 올라간다. */
  overflow: clip;
  background: var(--ground);
}

/* 경계선은 자리를 차지하지 않게 칸 위에 겹친다 — 세로선은 터미널 왼쪽 여백에, 가로선은 칸 머리 맨 위에. */
.edge-left::before,
.edge-top::after {
  content: '';
  position: absolute;
  z-index: 2;
  background: var(--line);
}

.edge-left::before {
  top: 0;
  bottom: 0;
  left: 0;
  width: 1px;
}

.edge-top::after {
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
}

.body {
  position: absolute;
  top: var(--row);
  left: 0;
  right: 0;
}

.pane:not(.focused) > .body::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  background: var(--dim);
  pointer-events: none;
}
</style>
