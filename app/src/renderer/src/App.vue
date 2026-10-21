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
import { available, commands, type CommandId } from '../../shared/commands'
import type { PaneReply } from '../../shared/pane'
import { clampSidebarWidth, SCREEN_VERSION, type ScreenState } from '../../shared/screen'
import { secondaryCommand } from '../../shared/shortcuts'
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
import { columnCount, EPSILON, rects, type Layout, type Widths } from './workspace/layout'
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
  removePane(w.focused)
  void focusSelected()
}

// `maru pane new`·`maru workspace new` 로 열어 세션이 뜨기를 기다리는 pane → 답할 요청 id.
const paneRequests = new Map<number, number>()

function answerPaneRequest(pane: number, reply: PaneReply): void {
  const id = paneRequests.get(pane)
  if (id === undefined) return
  paneRequests.delete(pane)
  window.maru.paneReply(id, reply)
}

function removePane(
  pane: number,
  message = 'the pane was closed before its session started'
): void {
  // 세션이 스스로 끝나 닫는 pane 도 kill 을 보낸다 — docs/architecture.md 의
  // "main 이 아는 세션의 workspace". 이미 끝난 세션의 kill 은 host 가 무시한다(`kill`, `main/session-host.ts`).
  terminals.get(pane)?.kill()
  answerPaneRequest(pane, { error: 'open_failed', message })
  workspaces.closePane(pane)
}

// ⌘D 로 나눈 pane 은 오류를 보인 채 남지만, `maru pane new`·`maru workspace new` 의 pane 은 띄운 쪽이 이유를
// 받으므로 닫는다.
function paneFailed(pane: number, message: string): void {
  if (paneRequests.has(pane)) removePane(pane, message)
}

const noPane = (session: string): PaneReply => ({
  error: 'no_pane',
  message: `no pane for session ${session}`
})

window.maru.onPaneNew((id, { session, cwd, direction, command, full }) => {
  const from = workspaces.paneBySession(session)
  if (!from) return window.maru.paneReply(id, noPane(session))
  paneRequests.set(workspaces.splitFrom(from.key, direction, { startDir: cwd, command }, full), id)
})

window.maru.onWorkspaceNew((id, { workspace, cwd, command }) => {
  paneRequests.set(workspaces.openFrom(workspace, { startDir: cwd, command }), id)
})

// `pane:cancel` 은 main 이 시간 초과한 요청의 id 를 싣는다. 그 요청으로 열어 아직 세션을 기다리는 pane 을 닫는다
// (docs/architecture.md 의 "시간 초과한 pane 요청은 창이 취소한다").
window.maru.onPaneCancel((id) => {
  for (const [pane, request] of paneRequests) {
    if (request === id) return removePane(pane, 'the request timed out')
  }
})

window.maru.onPaneClose((id, session) => {
  const pane = workspaces.paneBySession(session)
  if (!pane) return window.maru.paneReply(id, noPane(session))
  // 자기 pane 을 닫는 CLI 는 세션과 함께 끝나므로 끄기 전에 답한다.
  window.maru.paneReply(id, null)
  removePane(pane.key)
})

// 기억한 값을 처음 값으로 쓴다. 나중에 적용하면 사이드바를 기본값(열림·282px)으로 그린 뒤 기억한 값으로 transition 이 돈다.
const prefs = window.maru.viewPrefs
const sidebarOpen = ref(prefs.sidebar?.open ?? true)
const folded = reactive(new Set<number>())
function toggleFold(key: number): void {
  if (!folded.delete(key)) folded.add(key)
}
// 280 이면 기본 창에서 터미널 영역이 열 수의 경계에 걸려 칸마다 열 수가 갈린다(#58).
const sidebarWidth = ref(prefs.sidebar?.width ?? 282)
// 신호등 버튼 묶음 폭에 양옆 12px 씩을 더한 폭이다.
const RAIL_WIDTH = 85
const resizing = ref(false)
const side = useTemplateRef<HTMLElement>('side')

// 드래그하는 도중 사이드바를 닫으면 `.resizer` 가 DOM 에서 빠져 `pointerup` 을 받지 못하므로, window 에서 받는다.
function resizeSidebar(e: PointerEvent): void {
  if (e.button !== 0) return
  resizing.value = true
  // `max-width: 50vw` 로 줄어 있거나 펴지는 중이면 정한 폭(`sidebarWidth`)과 보이는 폭이 달라, 보이는 폭에서 시작한다.
  const from = side.value!.getBoundingClientRect().width - e.clientX
  const move = (m: PointerEvent): void => {
    sidebarWidth.value = clampSidebarWidth(from + m.clientX)
  }
  const end = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    resizing.value = false
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}

const viewMode = ref<'single' | 'columns'>(prefs.viewMode ?? 'columns')
const widths = computed<Widths>(() => (viewMode.value === 'columns' ? 'columns' : 'half'))
// 모든 터미널이 같은 글꼴을 쓰므로 마지막으로 잰 값 하나로 셈한다.
const cell = ref<Size>({ width: 0, height: 0 })
const cellFloored = ref(false)
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
// 사이드바 폭이 transition 으로 바뀌는 동안 칸 크기를 다시 재면 터미널이 프레임마다 맞춰져 PTY 크기가
// 여러 번 바뀐다. 그동안은 재지 않고, 끝난 뒤 다시 잰다.
let sideMoving = false
const gridObserver = new ResizeObserver((entries) => {
  if (sideMoving) return
  for (const {
    target,
    contentRect: { width, height }
  } of entries) {
    const key = gridKeys.get(target)
    if (key === undefined) continue
    const old = gridSizes.get(key)
    if (old?.width !== width || old.height !== height) gridSizes.set(key, { width, height })
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

function sideTransition(e: TransitionEvent): void {
  if (e.propertyName !== 'width') return
  // 움직이는 도중에 다시 토글하면 `transitioncancel` 이 오지만, 그때는 이미 반대로 가는 transition 이 돌고 있다.
  sideMoving = side.value!.getAnimations().some((a) => a.playState === 'running')
  if (sideMoving) return
  // 다시 observe 하면 지금 크기로 콜백이 한 번 온다.
  for (const el of gridEls.values()) {
    gridObserver.unobserve(el)
    gridObserver.observe(el)
  }
}

function setCell(c: Size, floored: boolean): void {
  if (c.width !== cell.value.width || c.height !== cell.value.height) cell.value = c
  cellFloored.value = floored
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

function placements(layout: Layout, size: Size | undefined, widths: Widths) {
  // 영역을 재기 전의 첫 렌더는 비율로 그린다. 0×0 으로 그리면 터미널이 그 크기로 세션을 연다.
  if (!size)
    return new Map(
      [...rects(layout, widths)].map(([pane, r]) => [
        pane,
        placement({ left: r.x * 100, top: r.y * 100, width: r.w * 100, height: r.h * 100 }, '%')
      ])
    )
  return new Map(
    [...snapRects(layout, size, cell.value, widths)].map(([pane, b]) => [
      pane,
      placement(b, 'px', bodyHeight(b))
    ])
  )
}

const views = computed(() =>
  workspaces.list.value.map((w) => {
    const selected = w.key === workspaces.selectedKey.value
    const measured = gridSizes.get(w.key)
    const columns = viewMode.value === 'columns'
    const width = columns
      ? columnsWidth(columnCount(w.layout), cell.value.width, cellFloored.value)
      : undefined
    const places = placements(
      w.layout,
      measured && (width === undefined ? measured : { width, height: measured.height }),
      widths.value
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

// 마우스 트래킹이 켜진 터미널에서 xterm 은 모든 wheel 을 preventDefault 한다. 프로그램에는 deltaY 만
// 보내므로 가로 스와이프는 프로그램에도 스크롤에도 가지 않는다. 스크롤백이 없는 alt buffer 에서도 xterm 은
// wheel 을 화살표 키로 바꾸고 preventDefault 한다. xterm 의 리스너보다 먼저 전파를 끊어 기본 스크롤이
// 일어나게 한다. attachCustomWheelEventHandler 에서 false 를 돌려줘도 그 리스너는 preventDefault 를 부른다.
function keepHorizontalScroll(e: WheelEvent): void {
  if (viewMode.value === 'columns' && Math.abs(e.deltaX) > Math.abs(e.deltaY)) e.stopPropagation()
}

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
  'focus-pane-left': () => workspaces.moveFocus('left', widths.value),
  'focus-pane-right': () => workspaces.moveFocus('right', widths.value),
  'focus-pane-up': () => workspaces.moveFocus('up', widths.value),
  'focus-pane-down': () => workspaces.moveFocus('down', widths.value),
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
  },
  restart: window.maru.restart
}

function runCommand(id: CommandId): void {
  if (id !== 'command-palette') closePalette()
  handlers[id]()
}
window.maru.onCommand(runCommand)

function isTextInput(t: EventTarget | null): boolean {
  if (t instanceof HTMLTextAreaElement) return !t.classList.contains('xterm-helper-textarea')
  return t instanceof HTMLInputElement || (t instanceof HTMLElement && t.isContentEditable)
}
// 입력창에서는 ⇧⌘방향키를 입력창에 맡겨 macOS 의 텍스트 선택 키로 쓰게 한다.
window.addEventListener('keydown', (e) => {
  const id = secondaryCommand(e)
  if (id === undefined || isTextInput(e.target)) return
  e.preventDefault()
  const command = commands.find((c) => c.id === id)!
  if (available(command, window.maru)) runCommand(id)
})

function screen(): ScreenState {
  return {
    version: SCREEN_VERSION,
    ...workspaces.snapshot(),
    sidebar: { open: sidebarOpen.value, width: sidebarWidth.value, folded: [...folded] },
    viewMode: viewMode.value
  }
}

void window.maru.restoreScreen().then((s) => {
  if (s?.workspaces.length) {
    workspaces.restore(s)
    sidebarOpen.value = s.sidebar.open
    sidebarWidth.value = s.sidebar.width
    for (const key of s.sidebar.folded) folded.add(key)
    viewMode.value = s.viewMode
  } else {
    workspaces.open()
  }
  watch(screen, window.maru.saveScreen, { immediate: true })
  // 되살린 터미널이 `session:open` 을 보낸 다음 tick 에 부른다(docs/architecture.md 의 "pane 요청은 창이 준비된 뒤에 넘긴다").
  void nextTick(window.maru.paneReady)
})
</script>

<template>
  <div class="app" :style="gridVars">
    <div
      ref="side"
      class="side"
      :class="{ resizing }"
      :style="{
        width: `${sidebarOpen ? sidebarWidth : RAIL_WIDTH}px`,
        '--rail': `${RAIL_WIDTH}px`
      }"
      @transitionrun.self="sideTransition"
      @transitionend.self="sideTransition"
      @transitioncancel.self="sideTransition"
    >
      <WorkspaceSidebar
        :collapsed="!sidebarOpen"
        :workspaces="workspaces.list.value"
        :selected-key="workspaces.selectedKey.value"
        :state="claude.state"
        :urgent="urgent"
        :folded="folded"
        :home="home"
        @select="selectWorkspace"
        @focus="selectPane"
        @fold="toggleFold"
      />
    </div>
    <div v-if="sidebarOpen" class="resizer" @mousedown.prevent @pointerdown="resizeSidebar" />
    <div class="terminals" :class="viewMode" @wheel.capture="keepHorizontalScroll">
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
          <span class="row-bar-icon status-icon nerd-icon">{{
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
                :session-id="p.sessionId"
                :workspace-id="w.id"
                :start-dir="p.startDir"
                :command="p.command"
                :attach="p.attach"
                :active="active"
                :shown="selected || viewMode === 'columns'"
                @exit="removePane(p.key)"
                @failed="(message) => paneFailed(p.key, message)"
                @spawned="answerPaneRequest(p.key, { session: p.sessionId })"
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

/* 창 폭의 반이라는 상한은 width 와 따로 두어, 창 크기를 바꿀 때는 transition 없이 바로 따라간다. */
.side {
  flex: none;
  display: flex;
  max-width: 50vw;
  overflow: hidden;
  background: var(--side);
  transition: width 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.side.resizing {
  transition: none;
}

.resizer {
  -webkit-app-region: no-drag;
  flex: none;
  z-index: 1;
  width: 6px;
  margin: 0 -3px;
  cursor: col-resize;
}

.terminals {
  position: relative;
  flex: 1;
  min-width: 0;
}

/* 사이드바가 펴지는 동안 칸은 이전 폭으로 남아, 자르지 않으면 Canvas 를 덮는다. */
.single {
  overflow: clip;
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
  /* 카드 테두리는 바깥 1px 의 box-shadow 라, 여백이 없으면 스크롤 영역이 그 1px 을 자른다. */
  padding: 8px;
  /* 포커스를 따라 scrollIntoView 할 때도 카드를 영역 끝에 붙이지 않고 같은 여백을 남긴다. */
  scroll-padding: 8px;
  background: var(--side);
  /* 스크롤바가 자리를 차지하는 설정에서, 넘치기 시작하거나 그칠 때마다 터미널의 줄 수가 바뀌지 않게. */
  overflow-x: scroll;
}

.columns .panes {
  position: relative;
  flex: none;
  border-radius: 6px;
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
