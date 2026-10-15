<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  reactive,
  ref,
  useTemplateRef,
  watch,
  watchEffect
} from 'vue'
import type { CommandId } from '../../shared/commands'
import { createCanvas } from './canvas/store'
import { createClaudeStatuses } from './claude/status'
import CanvasPanel from './components/CanvasPanel.vue'
import CommandPalette from './components/CommandPalette.vue'
import PaneHeader from './components/PaneHeader.vue'
import WorkspaceSidebar from './components/WorkspaceSidebar.vue'
import TerminalView from './components/TerminalView.vue'
import { FONT_FAMILY, FONT_SIZE } from './font'
import { ICONS } from './icons'
import { columnsWidth, terminalPadding } from './workspace/columns'
import { windowTitle, workspaceLabel } from './workspace/cwd'
import { snapRects, type Box, type Size } from './workspace/grid'
import { columnCount, EPSILON, rects, type Layout } from './workspace/layout'
import { createWorkspaces, focusedPane } from './workspace/store'

const canvas = createCanvas()
window.maru.onCanvasPut(canvas.put)

const workspaces = createWorkspaces(window.maru.gitHead)

const claude = createClaudeStatuses()
// zsh 는 프롬프트마다 cwd 를 알려 와 그때 branch 를 다시 읽지만, Claude 를 띄운 칸에는 프롬프트가 뜨지 않아
// 상태가 바뀔 때 읽는다. 그래서 Claude 가 한 상태에 머문 채 branch 를 바꾸면 다음 상태로 넘어갈 때 반영된다.
window.maru.onClaudeStatus((session, state) => {
  claude.set(session, state)
  workspaces.refreshSession(session)
})
void window.maru.claudeStatuses().then(claude.replace)
const home = window.maru.home
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

/** workspace 마다 칸이 놓이는 영역의 크기. CSS 가 정하는 머리·여백을 JS 에서 다시 계산하지 않게 잰다. */
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

function placement(b: Box, unit: string, bodyHeight?: number) {
  return {
    style: {
      left: `${b.left}${unit}`,
      top: `${b.top}${unit}`,
      width: `${b.width}${unit}`,
      height: `${b.height}${unit}`
    },
    body: bodyHeight === undefined ? { bottom: '0' } : { height: `${bodyHeight}px` },
    edge: b.left > 0
  }
}

// FitAddon 은 칸 높이를 정수로 잘라 읽고 반올림한 셀 높이로 나눠 행 하나를 잃곤 하므로, 머리 아래에 들어갈
// 행 수보다 반 행 큰 높이를 주고 넘친 부분은 칸이 가린다.
function bodyHeight(b: Box): number {
  const rows = Math.max(0, Math.floor(b.height / row.value - 1 + EPSILON))
  return (rows + 0.5) * row.value
}

function placements(layout: Layout, size: Size | undefined) {
  // 영역을 재기 전의 첫 렌더는 비율로 그린다. 0×0 으로 그리면 터미널이 그 크기로 세션을 연다.
  if (!size)
    return new Map(
      [...rects(layout)].map(([pane, r]) => [
        pane,
        placement({ left: r.x * 100, top: r.y * 100, width: r.w * 100, height: r.h * 100 }, '%')
      ])
    )
  return new Map(
    [...snapRects(layout, size, cell.value)].map(([pane, b]) => [
      pane,
      placement(b, 'px', bodyHeight(b))
    ])
  )
}

const views = computed(() =>
  workspaces.list.value.map((w) => {
    const selected = w.key === workspaces.selectedKey.value
    const measured = gridSizes.get(w.key)
    const width =
      viewMode.value === 'columns'
        ? columnsWidth(columnCount(w.layout), cell.value.width)
        : undefined
    const places = placements(
      w.layout,
      measured && (width === undefined ? measured : { width, height: measured.height })
    )
    return {
      w,
      selected,
      width: width === undefined ? undefined : `${width}px`,
      panes: w.panes.map((p) => ({
        p,
        active: selected && p.key === w.focused,
        ...places.get(p.key)!
      }))
    }
  })
)

// 스크롤 watch 가 views 를 지켜보므로, 칸의 cwd·branch 가 바뀔 때마다 스크롤이 돌지 않게 views 밖에 둔다.
const labels = computed(
  () => new Map(workspaces.list.value.map((w) => [w.key, workspaceLabel(focusedPane(w))]))
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
// 포커스가 같은 칸으로 돌아올 때도 불려, 여기서 칸을 다시 보이면 스크롤해 둔 자리를 잃는다.
function focusPane(workspace: number, pane: number): void {
  workspaces.focusPane(pane)
  workspaces.select(workspace)
}

function selectPane(workspace: number, pane: number): void {
  workspaces.focusPane(pane)
  selectWorkspace(workspace)
}

const appTitle = document.title
watchEffect(() => {
  const w = workspaces.selected()
  const p = w && focusedPane(w)
  document.title = p ? windowTitle(workspaceLabel(p)) : appTitle
  window.maru.setWindowPath(p?.cwd ?? '')
})

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
    <WorkspaceSidebar
      v-show="sidebarOpen"
      :workspaces="workspaces.list.value"
      :selected-key="workspaces.selectedKey.value"
      :state="claude.state"
      :home="home"
      @select="selectWorkspace"
      @focus="selectPane"
    />
    <div class="terminals" :class="viewMode">
      <div
        v-for="{ w, selected, width, panes } in views"
        :key="w.key"
        class="panes"
        :class="{ selected }"
        :style="{ width }"
      >
        <div
          v-if="viewMode === 'columns'"
          class="row-bar workspace-header"
          :class="[urgent.get(w.key), { focused: selected }]"
          @mousedown.prevent="selectWorkspace(w.key)"
        >
          <span class="row-bar-icon status-icon">{{
            urgent.has(w.key) ? ICONS[urgent.get(w.key)!] : ''
          }}</span>
          <span class="row-bar-text name">{{ labels.get(w.key)!.name }}</span>
          <span v-if="labels.get(w.key)!.branch" class="row-bar-text branch">{{
            labels.get(w.key)!.branch
          }}</span>
        </div>
        <div :ref="(el) => observeGrid(w.key, el)" class="grid">
          <div
            v-for="{ p, active, style, body, edge } in panes"
            :key="p.key"
            class="pane"
            :class="{ 'edge-left': edge, focused: active }"
            :style="style"
            @focusin="focusPane(w.key, p.key)"
          >
            <PaneHeader
              :state="claude.state(p.sessionId)"
              :pane="p"
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

.columns {
  display: flex;
  /* workspace 사이는 행을 이어 쓸 필요가 없어 틈을 두고 카드로 나눈다. */
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
  box-shadow: inset 0 -1px 0 var(--line);
}

.workspace-header .name {
  font-weight: bold;
}

.workspace-header .branch {
  color: var(--faint);
}

.pane {
  position: absolute;
  /* 다른 클라이언트가 primary 면 fit 하지 않아, 터미널이 칸보다 넓으면 옆 칸과 패널을 덮는다.
     hidden 이면 칸이 스크롤 영역이 되어, 칸보다 큰 터미널을 scrollIntoView 할 때 머리가 밀려 올라간다. */
  overflow: clip;
  background: var(--ground);
}

/* 좌우 칸의 경계선. 자리를 차지하지 않게 겹친다 — docs/architecture.md 의 "칸 경계와 셀 격자". */
.edge-left::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 2;
  width: 1px;
  background: var(--line);
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
