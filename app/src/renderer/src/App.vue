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
import {
  clampCanvasWidth,
  clampSidebarWidth,
  SCREEN_VERSION,
  type ScreenState
} from '../../shared/screen'
import { secondaryCommand } from '../../shared/shortcuts'
import { createCanvas } from './canvas/store'
import { createClaudeStatuses } from './claude/status'
import CanvasPanel from './components/CanvasPanel.vue'
import CommandPalette from './components/CommandPalette.vue'
import PaneHeader from './components/PaneHeader.vue'
import WorkspaceSidebar from './components/WorkspaceSidebar.vue'
import TerminalView from './components/TerminalView.vue'
import ToastStack from './components/ToastStack.vue'
import { missingFonts } from './config/fonts'
import { configToast, createConfig } from './config/store'
import { fontSizeOverride, stepFontSize, type TerminalFont } from './config/terminal'
import { ICONS } from './icons'
import { createToasts } from './toast/store'
import { columnsWidth, PANE_COLS, stepPaneCols, terminalPadding } from './workspace/columns'
import { tildePath, windowTitle, workspaceLabel } from './workspace/cwd'
import { snapRects, type Box, type Size } from './workspace/grid'
import { columnCount, EPSILON, rects, type Layout, type Widths } from './workspace/layout'
import { createWorkspaces, focusedPane, type Workspace } from './workspace/store'

const canvas = createCanvas()
window.maru.onCanvasPut(canvas.put)

const workspaces = createWorkspaces(window.maru.gitHead, window.maru.foregroundCwd)

const claude = createClaudeStatuses()
// zsh 는 프롬프트마다 cwd 를 알려 와 그때 branch 를 다시 읽지만, Claude 를 띄운 pane 에는 프롬프트가 뜨지 않아
// 상태가 바뀔 때와 Claude 가 상태 파일에 쓴 디렉토리가 바뀔 때 읽는다. 그래서 Claude 가 한 상태에 머문 채 branch 를
// 바꾸면 다음 상태로 넘어갈 때 반영된다.
window.maru.onClaudeStatus((session, state) => {
  claude.set(session, state)
  workspaces.refreshSession(session)
})
window.maru.onClaudeMoved(workspaces.refreshSession)
void window.maru.claudeStatuses().then(claude.replace)
const home = window.maru.home

const toasts = createToasts()
const config = createConfig(window.maru.config, (r) => {
  const toast = configToast(r, missingFonts(r.names), tildePath(r.path, home))
  if (toast) toasts.put('config', toast)
  else toasts.close('config')
})
window.maru.onConfig(config.apply)
const headerBottom = computed(() => config.layout.value.header === 'bottom')

function stepFont(by: 1 | -1): void {
  const w = workspaces.selected()
  if (!w) return
  const configured = config.font.value.fontSize
  const size = stepFontSize(w.fontSize ?? configured, by)
  workspaces.setFontSize(w.key, fontSizeOverride(size, configured))
}

function resetFont(): void {
  const w = workspaces.selected()
  if (w) workspaces.setFontSize(w.key, undefined)
}

function stepWidth(by: 1 | -1): void {
  const w = workspaces.selected()
  if (!w || viewMode.value !== 'columns') return
  const cols = stepPaneCols(w.paneCols ?? PANE_COLS, by)
  workspaces.setPaneCols(w.key, cols === PANE_COLS ? undefined : cols)
}

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
// 여기서 포커스를 주고 스크롤로 밀려난 pane 을 다시 보인다.
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
  // "main 이 아는 세션의 workspace". 이미 끝난 세션의 kill 은 세션 소켓에 닿지 못해 아무것도 하지 않는다(`main/session.ts` 의 `requestKill`).
  terminals.get(pane)?.kill()
  answerPaneRequest(pane, { error: 'open_failed', message })
  workspaces.closePane(pane)
}

// ⌘D 로 나눈 pane 은 오류를 보인 채 남지만, `maru pane new`·`maru workspace new` 의 pane 은 띄운 쪽이 이유를
// 받으므로 닫는다.
function paneFailed(pane: number, message: string): void {
  if (paneRequests.has(pane)) removePane(pane, message)
}

// 터미널 글자에서 찾은 링크는 `a/b.ext` 같은 글을 경로로 잘못 본 것일 수 있다. 실패를 알리지 않으면 왜 열리지 않는지 알 수 없다.
function linkFailed(reason: string): void {
  toasts.put('link', { level: 'warning', title: "Couldn't open the link", lines: [reason] })
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
// 280 이면 기본 창에서 터미널 영역이 열 수의 경계에 걸려 pane 마다 열 수가 갈린다(#58).
const SIDEBAR_WIDTH = 282
const sidebarWidth = ref(prefs.sidebar?.width ?? SIDEBAR_WIDTH)
// 토스트는 사이드바 안쪽 양옆 12px 을 비운다.
const toastWidth = computed(
  () => Math.max(sidebarOpen.value ? sidebarWidth.value : 0, SIDEBAR_WIDTH) - 24
)
// 신호등 버튼 묶음 폭에 양옆 12px 씩을 더한 폭이다.
const RAIL_WIDTH = 85
const resizing = ref<'side' | 'canvas' | null>(null)
const side = useTemplateRef<HTMLElement>('side')

// 드래그하는 도중 패널을 닫으면 `.resizer` 가 DOM 에서 빠져 `pointerup` 을 받지 못하므로, window 에서 받는다.
function drag(e: PointerEvent, panel: 'side' | 'canvas', move: (m: PointerEvent) => void): void {
  if (e.button !== 0) return
  resizing.value = panel
  // 패널이 닫힌 뒤에도 포인터를 따라 폭을 바꾸면, 보이지 않는 폭이 바뀌어 저장된다.
  const open = (): boolean => (panel === 'side' ? sidebarOpen.value : canvas.open.value)
  const step = (m: PointerEvent): void => (open() ? move(m) : end())
  const end = (): void => {
    window.removeEventListener('pointermove', step)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    resizing.value = null
  }
  window.addEventListener('pointermove', step)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}

function resizeSidebar(e: PointerEvent): void {
  // `max-width: 50vw` 로 줄어 있거나 펴지는 중이면 정한 폭(`sidebarWidth`)과 보이는 폭이 달라, 보이는 폭에서 시작한다.
  const from = side.value!.getBoundingClientRect().width - e.clientX
  drag(e, 'side', (m) => (sidebarWidth.value = clampSidebarWidth(from + m.clientX)))
}

const canvasWidth = ref(prefs.canvas?.width)
const canvasPanel = useTemplateRef<InstanceType<typeof CanvasPanel>>('canvasPanel')

function resizeCanvas(e: PointerEvent): void {
  const from = canvasPanel.value!.panel!.getBoundingClientRect().width + e.clientX
  // 정한 폭(`canvasWidth`)이 보이는 폭보다 커지지 않게, 터미널 영역의 폭이 0 이 되는 데서 멈춘다.
  const max = window.innerWidth - side.value!.getBoundingClientRect().width
  drag(e, 'canvas', (m) => (canvasWidth.value = Math.min(max, clampCanvasWidth(from - m.clientX))))
}

const viewMode = ref<'single' | 'columns'>(prefs.viewMode ?? 'columns')
const widths = computed<Widths>(() => (viewMode.value === 'columns' ? 'columns' : 'half'))
// 셀 크기는 글꼴이 정하므로 글꼴마다 마지막으로 잰 값 하나로 셈한다. 그래서 새로 연 workspace 도 같은 글꼴의 터미널이
// 잰 값으로 바로 그린다.
const cells = reactive(new Map<string, Size>())
const cellFloored = ref(false)
const FALLBACK_ROW = 18
const NO_CELL: Size = { width: 0, height: 0 }

const fontKey = (f: TerminalFont): string => `${f.fontFamily}\n${f.fontSize}\n${f.lineHeight}`
const cellOf = (font: TerminalFont): Size => cells.get(fontKey(font)) ?? NO_CELL
const rowOf = (cell: Size): number => cell.height || FALLBACK_ROW

function fontOf(w: Pick<Workspace, 'fontSize'>): TerminalFont {
  const font = config.font.value
  return w.fontSize === undefined ? font : { ...font, fontSize: w.fontSize }
}

function gridVars(cell: Size, font: TerminalFont) {
  return {
    '--row': `${rowOf(cell)}px`,
    '--cell': `${cell.width}px`,
    '--pad': `${terminalPadding(cell.width)}px`,
    '--font-size': `${font.fontSize}px`,
    '--font-family': font.fontFamily
  }
}

const sameSize = (a: Size | undefined, b: Size): boolean =>
  a?.width === b.width && a.height === b.height

/** workspace 마다 pane 이 놓이는 영역의 크기. CSS 가 정하는 헤더·여백을 JS 에서 다시 계산하지 않게 잰다. */
const gridSizes = reactive(new Map<number, Size>())
const gridEls = new Map<number, Element>()
const gridKeys = new WeakMap<Element, number>()
// 사이드바·Canvas 폭이 transition 으로 바뀌는 동안 pane 크기를 다시 재면 터미널이 프레임마다 맞춰져 PTY 크기가
// 여러 번 바뀐다. 그동안은 재지 않고, 끝난 뒤 다시 잰다.
const panels = (): Element[] => [side.value, canvasPanel.value?.panel].filter((el) => !!el)
// `transitionrun` 은 transition 이 생긴 다음 프레임에 온다. 그래서 그것으로 움직임을 알면, 그 전 프레임의 크기로 터미널을
// 한 번 더 맞춘다. Canvas 를 닫을 때 다시 여는 띠가 바로 자리를 잡는 프레임이 그렇다. transition 은 스타일을 계산할 때
// 생기므로, `gridObserver` 콜백이 돌 때는 `getAnimations()` 에 이미 있다.
// 폭이 아닌 transition 은 보지 않는다. Canvas 가 닫힐 때의 visibility 는 늘 180ms 를 다 채워, 되돌아가느라 일찍 끝난
// 폭의 `transitionend` 를 놓치게 한다.
const PANEL_SIZES = ['width', 'flex-basis']
const panelsMoving = (): boolean =>
  panels().some((el) =>
    el
      .getAnimations()
      .some(
        (a) =>
          a.playState === 'running' &&
          a instanceof CSSTransition &&
          PANEL_SIZES.includes(a.transitionProperty)
      )
  )
const gridObserver = new ResizeObserver((entries) => {
  if (panelsMoving()) return
  for (const {
    target,
    contentRect: { width, height }
  } of entries) {
    const key = gridKeys.get(target)
    if (key === undefined) continue
    const old = gridSizes.get(key)
    if (!sameSize(old, { width, height })) gridSizes.set(key, { width, height })
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

function panelTransition(e: TransitionEvent): void {
  if (!PANEL_SIZES.includes(e.propertyName)) return
  if (!panels().includes(e.target as Element)) return
  // 움직이는 도중에 다시 토글하면 `transitioncancel` 이 오지만, 그때는 이미 반대로 가는 transition 이 돌고 있다.
  if (panelsMoving()) return
  // 다시 observe 하면 지금 크기로 콜백이 한 번 온다.
  for (const el of gridEls.values()) {
    gridObserver.unobserve(el)
    gridObserver.observe(el)
  }
}

function setCell(font: TerminalFont, c: Size, floored: boolean): void {
  const key = fontKey(font)
  if (!sameSize(cells.get(key), c)) cells.set(key, c)
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
    body: bodyHeight === undefined ? {} : { height: `${bodyHeight}px` },
    edge: b.left > 0
  }
}

// FitAddon 은 pane 높이를 정수로 잘라 읽고 반올림한 셀 높이로 나눠 행 하나를 잃곤 하므로, 헤더를 뺀 행 수보다
// 반 행 큰 높이를 준다. 넘친 반 행은 헤더가 아래면 헤더가 덮고, 위면 pane 이 자른다.
function bodyHeight(b: Box, row: number): number {
  const rows = Math.max(0, Math.floor(b.height / row - 1 + EPSILON))
  return (rows + 0.5) * row
}

function placements(layout: Layout, size: Size | undefined, widths: Widths, cell: Size) {
  // 영역을 재기 전의 첫 렌더는 비율로 그린다. 0×0 으로 그리면 터미널이 그 크기로 세션을 연다.
  if (!size)
    return new Map(
      [...rects(layout, widths)].map(([pane, r]) => [
        pane,
        placement({ left: r.x * 100, top: r.y * 100, width: r.w * 100, height: r.h * 100 }, '%')
      ])
    )
  return new Map(
    [...snapRects(layout, size, cell, widths)].map(([pane, b]) => [
      pane,
      placement(b, 'px', bodyHeight(b, rowOf(cell)))
    ])
  )
}

const views = computed(() =>
  workspaces.list.value.map((w) => {
    const selected = w.key === workspaces.selectedKey.value
    const measured = gridSizes.get(w.key)
    const columns = viewMode.value === 'columns'
    const font = fontOf(w)
    const cell = cellOf(font)
    const width = columns
      ? columnsWidth(columnCount(w.layout), cell.width, cellFloored.value, w.paneCols)
      : undefined
    const places = placements(
      w.layout,
      measured && (width === undefined ? measured : { width, height: measured.height }),
      widths.value,
      cell
    )
    return {
      w,
      selected,
      font,
      vars: gridVars(cell, font),
      width: width === undefined ? undefined : `${width}px`,
      panes: w.panes.map((p) => ({
        p,
        active: selected && p.key === w.focused,
        ...places.get(p.key)!
      }))
    }
  })
)

// 스크롤 watch 가 views 를 지켜보므로, pane 의 cwd·branch 가 바뀔 때마다 스크롤이 돌지 않게 views 밖에 둔다.
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

// columns 에서는 다른 workspace 의 pane 도 보여 눌러 포커스를 줄 수 있으므로, 그 workspace 를 선택한다.
// 포커스가 같은 pane 으로 돌아올 때도 불려, 여기서 pane 을 다시 보이면 스크롤해 둔 자리를 잃는다.
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

// workspace 가 화면보다 넓을 수 있어, workspace 가 아니라 포커스된 pane 이 보이게 한다.
function revealFocused(): void {
  const w = workspaces.selected()
  if (viewMode.value === 'columns' && w)
    terminals.get(w.focused)?.$el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
// 포커스가 그대로여도 앞의 workspace 가 닫히거나 폭이 바뀌면 pane 이 밀려나 views 도 지켜본다.
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
  'increase-font-size': () => stepFont(1),
  'decrease-font-size': () => stepFont(-1),
  'reset-font-size': resetFont,
  'widen-workspace': () => stepWidth(1),
  'narrow-workspace': () => stepWidth(-1),
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
// ⇧⌘방향키는 macOS 의 텍스트 선택 키이므로, 입력창에 포커스가 있으면 `secondaryCommand` 의 키는 입력창에 맡긴다. 메뉴에 건 키는 입력창에서도 돈다.
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
    viewMode: viewMode.value,
    ...(canvasWidth.value === undefined ? {} : { canvas: { width: canvasWidth.value } })
  }
}

void window.maru.restoreScreen().then((s) => {
  if (s?.workspaces.length) {
    workspaces.restore(s)
    sidebarOpen.value = s.sidebar.open
    sidebarWidth.value = s.sidebar.width
    for (const key of s.sidebar.folded) folded.add(key)
    viewMode.value = s.viewMode
    if (s.canvas) canvasWidth.value = s.canvas.width
  } else {
    workspaces.open()
  }
  watch(screen, window.maru.saveScreen, { immediate: true })
  // 되살린 터미널이 `session:open` 을 보낸 다음 tick 에 부른다(docs/architecture.md 의 "pane 요청은 창이 준비된 뒤에 넘긴다").
  void nextTick(window.maru.paneReady)
})
</script>

<template>
  <div
    class="app"
    :class="{ 'header-bottom': headerBottom }"
    @transitionend="panelTransition"
    @transitioncancel="panelTransition"
  >
    <div
      ref="side"
      class="side"
      :class="{ resizing: resizing === 'side' }"
      :style="{
        width: `${sidebarOpen ? sidebarWidth : RAIL_WIDTH}px`,
        '--rail': `${RAIL_WIDTH}px`
      }"
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
        v-for="{ w, selected, width, font, vars, panes } in views"
        :key="w.key"
        class="panes"
        :class="{ selected }"
        :style="{ width, ...vars }"
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
                :font="font"
                @exit="removePane(p.key)"
                @failed="(message) => paneFailed(p.key, message)"
                @spawned="answerPaneRequest(p.key, { session: p.sessionId })"
                @cwd="(dir) => workspaces.setCwd(p.key, dir)"
                @link-failed="linkFailed"
                @title="(title) => workspaces.setTitle(p.key, title)"
                @cell="(c, floored) => setCell(fontOf(w), c, floored)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
    <div
      v-if="canvas.open.value"
      class="resizer canvas-edge"
      @mousedown.prevent
      @pointerdown="resizeCanvas"
    />
    <CanvasPanel
      ref="canvasPanel"
      :canvas="canvas"
      :width="canvasWidth"
      :resizing="resizing === 'canvas'"
    />
    <ToastStack :toasts="toasts.list.value" :width="toastWidth" @close="toasts.close" />
    <CommandPalette
      v-if="paletteOpen"
      ref="palette"
      :position="config.layout.value.palette"
      @run="runCommand"
      @close="closePalette"
    />
  </div>
</template>

<style scoped>
.app {
  --panel-duration: 180ms;
  --panel-easing: cubic-bezier(0.2, 0.8, 0.2, 1);
  position: relative;
  display: flex;
  height: 100%;
  background: var(--side);
}

/* 창 폭의 반이라는 상한은 width 와 따로 두어, 창 크기를 바꿀 때는 transition 없이 바로 따라간다. */
.side {
  flex: none;
  display: flex;
  max-width: 50vw;
  overflow: hidden;
  background: var(--side);
  transition: width var(--panel-duration) var(--panel-easing);
}

.side.resizing {
  transition: none;
}

/* `.resizer` 는 패널 쪽에만 겹친다. 카드에 걸치면 맨 끝 터미널의 스크롤바를 가린다. */
.resizer {
  -webkit-app-region: no-drag;
  flex: none;
  /* Canvas 쪽 경계는 DOM 에서 뒤에 오는 Canvas 보다 위에 그려야 포인터 이벤트를 받는다. */
  z-index: 2;
  width: 6px;
  margin-left: -6px;
  cursor: col-resize;
}

.resizer.canvas-edge {
  margin: 0 -6px 0 0;
}

.terminals {
  position: relative;
  flex: 1;
  min-width: 0;
  z-index: 1;
  border-radius: 8px;
  box-shadow:
    0 0 0 1px var(--line),
    0 4px 24px rgb(0 0 0 / 0.65);
}

/* 사이드바가 펴지는 동안 pane 은 이전 폭으로 남아, 자르지 않으면 Canvas 를 덮는다. */
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
  background: color-mix(in srgb, var(--side), var(--ground));
  /* 스크롤바가 자리를 차지하는 설정에서, 넘치기 시작하거나 그칠 때마다 터미널의 줄 수가 바뀌지 않게. */
  overflow-x: scroll;
  scrollbar-width: thin;
  /* 스크롤바가 자리를 차지하는 설정에서는 넘치지 않을 때도 트랙에 색을 칠한다. 트랙이 투명하면 넘치기 시작할 때 비어 있던 스크롤바 자리에 thumb 만 나타나고, 넘침이 그치면 사라지기 때문이다.
     overlay 스크롤바 설정에서는 가만히 있을 때도 스크롤할 때도 트랙이 보이지 않는다.
     스크롤바가 나타난 동안 그 위에 마우스를 올리면 트랙이 칠해진다. */
  scrollbar-color: var(--thumb) var(--track);
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

.header-bottom .workspace-header {
  order: 1;
  box-shadow: inset 0 1px 0 var(--line);
}

.workspace-header .name {
  font-weight: bold;
}

.workspace-header .branch {
  color: var(--faint);
}

.pane {
  position: absolute;
  /* 다른 클라이언트가 primary 면 fit 하지 않아, 터미널이 pane 보다 넓으면 옆 pane 과 패널을 덮는다.
     hidden 이면 pane 이 스크롤 영역이 되어, pane 보다 큰 터미널을 scrollIntoView 할 때 헤더가 밀려 올라간다. */
  overflow: clip;
  background: var(--ground);
}

/* 좌우 pane 의 경계선. 자리를 차지하지 않게 겹친다 — docs/architecture.md 의 "pane 경계와 셀 격자". */
.edge-left::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 3;
  width: 1px;
  background: var(--line);
}

/* 헤더는 본문 위에 겹친다. 본문은 `bodyHeight` 가 준 반 행만큼 pane 을 넘칠 수 있다. 헤더가 아래면 넘친 부분을 헤더가 덮고,
   위면 pane 이 자른다. */
.pane-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
}

/* 영역을 재기 전에는 본문이 pane 아래 끝까지 채운다. 잰 뒤에는 `placement` 가 준 height 가 bottom 보다 앞선다. */
.body {
  position: absolute;
  top: var(--row);
  bottom: 0;
  left: 0;
  right: 0;
}

.header-bottom .pane-header {
  top: auto;
  bottom: 0;
}

.header-bottom .body {
  top: 0;
  bottom: var(--row);
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
