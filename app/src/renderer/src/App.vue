<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  reactive,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
  watchEffect
} from 'vue'
import { available, commands, type CommandId } from '../../shared/commands'
import { PANE_MIN } from '../../shared/layout'
import { cellLabel, windowTitle } from '../../shared/names'
import type { JobView } from '../../shared/job'
import type { PaneReply } from '../../shared/pane'
import type { ProgramStatusRecord } from '../../shared/program-status'
import {
  clampCanvasWidth,
  clampSidebarWidth,
  SCREEN_VERSION,
  type ScreenState
} from '../../shared/screen'
import { secondaryCommand } from '../../shared/shortcuts'
import { uiColors, xtermTheme } from '../../shared/theme'
import { createCanvas } from './canvas/store'
import { createPtyStates, syncPtyStates } from './pty/states'
import { syncJobs } from './workspace/jobs'
import CanvasPanel from './components/CanvasPanel.vue'
import CommandPalette from './components/CommandPalette.vue'
import PaneHeader from './components/PaneHeader.vue'
import StatusIcon from './components/StatusIcon.vue'
import WorkspaceSidebar from './components/WorkspaceSidebar.vue'
import TerminalView from './components/TerminalView.vue'
import ToastStack from './components/ToastStack.vue'
import { missingFonts } from './config/fonts'
import { configToast, createConfig } from './config/store'
import { fontSizeOverride, stepFontSize, type TerminalFont } from './config/terminal'
import { activeTheme, windowTheme } from './themes'
import { createToasts } from './toast/store'
import {
  columnWidth,
  fitCols,
  paneCells,
  stepPaneCols,
  TERMINAL_PADDING
} from './workspace/columns'
import { tildePath } from './workspace/cwd'
import { canSplit, snapRects, type Box, type Size } from './workspace/grid'
import {
  columnCount,
  EPSILON,
  rects,
  splitPane,
  splitRoot,
  type Layout,
  type SplitDirection,
  type Widths
} from './workspace/layout'
import {
  createWorkspaces,
  focusedPane,
  startDirOf,
  type Cell,
  type PlaceError
} from './workspace/store'

const canvas = createCanvas()
window.maru.onCanvasPut(canvas.put)

const ptyStates = createPtyStates()
const workspaces = createWorkspaces(window.maru.gitHead, ptyStates)
syncPtyStates((pty, entry) => {
  ptyStates.apply(pty, entry)
  workspaces.applyState(pty)
}, window.maru)

// 이전 maru-pty 의 pty 만 attach 스트림으로 레코드를 보낸다(`pty/states.ts`).
function onLegacyProgramStatus(pty: string, records: ProgramStatusRecord[]): void {
  ptyStates.setLegacyRecords(pty, records)
  if (ptyStates.isOld(pty)) workspaces.applyState(pty)
}
const home = window.maru.home
const shell = window.maru.shell

const jobs = shallowRef<JobView[]>([])
syncJobs((list) => (jobs.value = list), window.maru)
// job 과 pane 의 명령이 돈 시간은 분 단위로 보이므로 그보다 잦게만 다시 센다.
const now = ref(Date.now())
setInterval(() => {
  const running =
    jobs.value.some((j) => !j.exit) ||
    workspaces.cells().some((c) => c.panes.some((p) => ptyStates.command(p.ptyId)?.running))
  if (running) now.value = Date.now()
}, 30_000)

function killJob(pty: string): void {
  void window.maru.killJob(pty)
}

const toasts = createToasts()
const config = createConfig(window.maru.config, (r) => {
  const toast = configToast(r, missingFonts(r.names), tildePath(r.path, home))
  if (toast) toasts.put('config', toast)
  else toasts.close('config')
})
window.maru.onConfig(config.apply)
const headerBottom = computed(() => config.layout.value.header === 'bottom')

// `prefers-color-scheme` 은 `nativeTheme.themeSource` 가 `system` 일 때만 OS 모드를 따른다(`shared/theme.ts` 의 `WindowTheme`).
const darkScheme = matchMedia('(prefers-color-scheme: dark)')
const prefersDark = ref(darkScheme.matches)
darkScheme.addEventListener('change', (e) => (prefersDark.value = e.matches))
const theme = computed(() => activeTheme(config.theme.value, prefersDark.value))
const terminalTheme = computed(() => xtermTheme(theme.value))
watchEffect(() => {
  for (const [name, color] of Object.entries(uiColors(theme.value)))
    document.documentElement.style.setProperty(
      `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
      color
    )
  window.maru.applyTheme(windowTheme(config.theme.value, prefersDark.value))
})

function stepFont(by: 1 | -1): void {
  const c = workspaces.selected()
  if (!c) return
  const configured = config.font.value.fontSize
  const size = stepFontSize(c.fontSize ?? configured, by)
  workspaces.setFontSize(c.key, fontSizeOverride(size, configured))
}

function resetFont(): void {
  const c = workspaces.selected()
  if (c) workspaces.setFontSize(c.key, undefined)
}

function stepWidth(by: 1 | -1): void {
  const c = workspaces.selected()
  if (!c || viewMode.value !== 'columns') return
  const configured = config.layout.value.columnCols
  const cols = stepPaneCols(paneColsOf(c), by, configured)
  workspaces.setPaneCols(c.key, cols === configured ? undefined : cols)
}

function startDir(): string | undefined {
  const c = workspaces.selected()
  return c && startDirOf(focusedPane(c))
}

function newWorkspace(): void {
  workspaces.open(startDir())
}

function newCell(): void {
  workspaces.openCell(startDir())
}

type Terminal = InstanceType<typeof TerminalView>
const terminals = new Map<number, Terminal>()
function setTerminal(key: number, t: unknown): void {
  if (t) terminals.set(key, t as Terminal)
  else terminals.delete(key)
}

function focusedTerminal(): Terminal | undefined {
  const c = workspaces.selected()
  return c && terminals.get(c.focused)
}

// 보이지 않는 터미널에는 포커스를 줄 수 없어, 선택이 화면에 반영된 뒤에 준다.
async function focusSelected(): Promise<void> {
  await nextTick()
  focusedTerminal()?.focus()
}

// 선택이 그대로인 클릭에서는 TerminalView 의 active watch 와 아래의 스크롤 watch 가 돌지 않아,
// 여기서 포커스를 주고 스크롤로 밀려난 pane 을 다시 보인다.
function selectCell(key: number): void {
  workspaces.select(key)
  void focusSelected().then(revealFocused)
}

function stepCell(by: 1 | -1): void {
  const key = workspaces.step(by)
  if (key !== undefined) selectCell(key)
}

let closingPane = false
let pendingCloses = 0

// ⌘W 를 꾹 누르면 누를 때마다 focus 된 pane 을 하나씩 닫는다. 다음에 닫을 pane 은 앞의 pane 이 닫혀야 정해지므로,
// 확인하는 동안 온 ⌘W 는 세어 두었다가 이어서 닫는다. 확인 창이 떴으면 세어 둔 것은 버린다.
// 확인 창이 떠 있는 동안 pane 이 스스로 닫혔으면 `removePane` 은 아무것도 하지 않는다.
async function closePane(): Promise<void> {
  if (closingPane) {
    pendingCloses++
    return
  }
  closingPane = true
  try {
    for (;;) {
      const c = workspaces.selected()
      if (!c) break
      const p = focusedPane(c)
      const { close, asked } = await window.maru.confirmClosePane(p.ptyId)
      if (close) removePane(p.key)
      if (asked || pendingCloses === 0) break
      pendingCloses--
    }
  } finally {
    closingPane = false
    pendingCloses = 0
    void focusSelected()
  }
}

// 마지막 cell 이 닫히면 store 가 workspace 를 지운다. cell 의 job 은 cell 이 닫힐 때 main 이 끈다.
async function closeWorkspace(): Promise<void> {
  const c = workspaces.selected()
  const w = c && workspaces.workspaceOf(c.key)
  if (!w) return
  const panes = w.cells.flatMap((x) => x.panes.map((p) => p.key))
  if ((await window.maru.confirmCloseWorkspace(w.id)).close) for (const p of panes) removePane(p)
  void focusSelected()
}

// `maru pane new`·`maru cell new` 로 열어 pty 가 뜨기를 기다리는 pane → 답할 요청 id.
const paneRequests = new Map<number, number>()

function answerPaneRequest(pane: number, reply: PaneReply): void {
  const id = paneRequests.get(pane)
  if (id === undefined) return
  paneRequests.delete(pane)
  window.maru.paneReply(id, reply)
}

function removePane(pane: number, message = 'the pane was closed before its pty started'): void {
  // pty 가 스스로 끝나 닫는 pane 도 kill 을 보낸다 — docs/architecture.md 의
  // "main 이 아는 pty 의 cell". 이미 끝난 pty 의 kill 은 pty 소켓에 닿지 못해 아무것도 하지 않는다(`main/pty.ts` 의 `requestKill`).
  terminals.get(pane)?.kill()
  answerPaneRequest(pane, { error: 'open_failed', message })
  const pty = workspaces.pane(pane)?.ptyId
  if (pty) ptyStates.remove(pty)
  workspaces.closePane(pane)
}

function onSpawned(pane: number, pty: string, dir: string | undefined): void {
  answerPaneRequest(pane, { pty })
  if (dir !== undefined) workspaces.setSpawnedCwd(pane, dir)
}

// ⌘D 로 나눈 pane 은 오류를 보인 채 남지만, `maru pane new`·`maru cell new` 의 pane 은 띄운 쪽이 이유를
// 받으므로 닫는다.
function paneFailed(pane: number, message: string): void {
  if (paneRequests.has(pane)) removePane(pane, message)
}

// 터미널 글자에서 찾은 링크는 `a/b.ext` 같은 글을 경로로 잘못 본 것일 수 있다. 실패를 알리지 않으면 왜 열리지 않는지 알 수 없다.
function linkFailed(reason: string): void {
  toasts.put('link', { level: 'warning', title: "Couldn't open the link", lines: [reason] })
}

const noPane = (pty: string): PaneReply => ({
  error: 'no_pane',
  message: `no pane for pty ${pty}`
})

window.maru.onPaneNew((id, { pty, cwd, direction, command, full }) => {
  const from = workspaces.paneByPty(pty)
  if (!from) return window.maru.paneReply(id, noPane(pty))
  if (!roomFor(from.key, direction, full)) {
    return window.maru.paneReply(id, { error: 'no_space', message: 'no space for a new pane' })
  }
  paneRequests.set(workspaces.splitFrom(from.key, direction, { startDir: cwd, command }, full), id)
})

window.maru.onCellNew((id, { cell, cwd, command, place }) => {
  const pane = workspaces.openCellFrom(cell, { startDir: cwd, command }, place)
  if (typeof pane !== 'number') {
    return window.maru.paneReply(id, { error: 'bad_place', message: placeErrors[pane] })
  }
  paneRequests.set(pane, id)
})

const placeErrors: Record<PlaceError, string> = {
  no_caller: 'this terminal is not in a cell, so there is no workspace to place the new cell in',
  no_cell: 'the cell to place the new cell by was closed',
  other_workspace: 'the cell to place the new cell by is not in the workspace of this terminal'
}

// `pane:cancel` 은 main 이 시간 초과한 요청의 id 를 싣는다. 그 요청으로 열어 아직 pty 를 기다리는 pane 을 닫는다
// (docs/architecture.md 의 "시간 초과한 pane 요청은 창이 취소한다").
window.maru.onPaneCancel((id) => {
  for (const [pane, request] of paneRequests) {
    if (request === id) return removePane(pane, 'the request timed out')
  }
})

window.maru.onPaneClose((id, pty) => {
  const pane = workspaces.paneByPty(pty)
  if (!pane) return window.maru.paneReply(id, noPane(pty))
  // 자기 pane 을 닫는 CLI 는 pty 와 함께 끝나므로 끄기 전에 답한다.
  window.maru.paneReply(id, null)
  removePane(pane.key)
})

// 기억한 값을 처음 값으로 쓴다. 나중에 적용하면 사이드바를 기본값(열림·280px)으로 그린 뒤 기억한 값으로 transition 이 돈다.
const prefs = window.maru.viewPrefs
const sidebarOpen = ref(prefs.sidebar?.open ?? true)
const folded = reactive(new Set<number>())
function toggleFold(key: number): void {
  if (!folded.delete(key)) folded.add(key)
}
const SIDEBAR_WIDTH = 280
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
// 글자 칸 크기는 글꼴이 정하므로 글꼴마다 마지막으로 잰 값 하나로 셈한다. 그래서 새로 연 cell 도 같은 글꼴의 터미널이
// 잰 값으로 바로 그린다.
const cells = reactive(new Map<string, Size>())
const FALLBACK_ROW = 18
const NO_CELL: Size = { width: 0, height: 0 }

const fontKey = (f: TerminalFont): string => `${f.fontFamily}\n${f.fontSize}\n${f.lineHeight}`
const cellOf = (font: TerminalFont): Size => cells.get(fontKey(font)) ?? NO_CELL
const rowOf = (cell: Size): number => cell.height || FALLBACK_ROW

function fontOf(c: Pick<Cell, 'fontSize'>): TerminalFont {
  const font = config.font.value
  return c.fontSize === undefined ? font : { ...font, fontSize: c.fontSize }
}

function paneColsOf(c: Pick<Cell, 'paneCols'>): number {
  return c.paneCols ?? config.layout.value.columnCols
}

function gridVars(cell: Size, font: TerminalFont) {
  return {
    '--row': `${rowOf(cell)}px`,
    '--cell': `${cell.width}px`,
    '--pad': `${TERMINAL_PADDING}px`,
    '--font-size': `${font.fontSize}px`,
    '--font-family': font.fontFamily
  }
}

const sameSize = (a: Size | undefined, b: Size): boolean =>
  a?.width === b.width && a.height === b.height

/** cell 마다 `.panes` 의 크기. CSS 가 정하는 여백을 JS 에서 다시 계산하지 않게 잰다. */
const panesSizes = reactive(new Map<number, Size>())
// pane 이 놓이는 영역은 `.panes` 에서 cell 헤더(높이 `--row`)를 뺀 것이다. 영역을 직접 재면 줄 높이가 바뀐 첫 렌더는
// 헤더만 새 높이이고 잰 영역은 옛 높이라, pane 이 한 프레임 동안 옛 영역에 맞춰 놓여 프로그램에 resize 가 두 번 간다.
function gridOf(key: number, cell: Size): Size | undefined {
  const s = panesSizes.get(key)
  return s && { width: s.width, height: Math.max(0, s.height - rowOf(cell)) }
}
const panesEls = new Map<number, Element>()
const panesKeys = new WeakMap<Element, number>()
// 사이드바·Canvas 폭이 transition 으로 바뀌는 동안 pane 크기를 다시 재면 터미널이 프레임마다 맞춰져 PTY 크기가
// 여러 번 바뀐다. 그동안은 재지 않고, 끝난 뒤 다시 잰다.
const panels = (): Element[] => [side.value, canvasPanel.value?.panel].filter((el) => !!el)
// `transitionrun` 은 transition 이 생긴 다음 프레임에 온다. 그래서 그것으로 움직임을 알면, 그 전 프레임의 크기로 터미널을
// 한 번 더 맞춘다. Canvas 를 닫을 때 다시 여는 띠가 바로 자리를 잡는 프레임이 그렇다. transition 은 스타일을 계산할 때
// 생기므로, `panesObserver` 콜백이 돌 때는 `getAnimations()` 에 이미 있다.
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
const panesObserver = new ResizeObserver((entries) => {
  if (panelsMoving()) return
  for (const {
    target,
    contentRect: { width, height }
  } of entries) {
    const key = panesKeys.get(target)
    if (key === undefined) continue
    const old = panesSizes.get(key)
    if (!sameSize(old, { width, height })) panesSizes.set(key, { width, height })
  }
})
function observePanes(key: number, el: unknown): void {
  const old = panesEls.get(key)
  if (old === el) return
  if (old) panesObserver.unobserve(old)
  if (el instanceof Element) {
    panesEls.set(key, el)
    panesKeys.set(el, key)
    panesObserver.observe(el)
  } else {
    panesEls.delete(key)
    panesSizes.delete(key)
  }
}
onBeforeUnmount(() => panesObserver.disconnect())

function panelTransition(e: TransitionEvent): void {
  if (!PANEL_SIZES.includes(e.propertyName)) return
  if (!panels().includes(e.target as Element)) return
  // 움직이는 도중에 다시 토글하면 `transitioncancel` 이 오지만, 그때는 이미 반대로 가는 transition 이 돌고 있다.
  if (panelsMoving()) return
  // 다시 observe 하면 지금 크기로 콜백이 한 번 온다.
  for (const el of panesEls.values()) {
    panesObserver.unobserve(el)
    panesObserver.observe(el)
  }
}

function setCell(font: TerminalFont, c: Size): void {
  const key = fontKey(font)
  if (!sameSize(cells.get(key), c)) cells.set(key, c)
}

type TerminalSize = { cols: number; rows: number }

function placement(b: Box, unit: string, size?: TerminalSize) {
  return {
    style: {
      left: `${b.left}${unit}`,
      top: `${b.top}${unit}`,
      width: `${b.width}${unit}`,
      height: `${b.height}${unit}`
    },
    size,
    edge: b.left > 0
  }
}

/** columns 보기에서는 cell 의 pane 열 수(`paneColsOf`), single 보기에서는 없다. */
type ColumnCols = number | undefined

/**
 * pane 상자 `b` 에 놓을 터미널의 열·행 수. 행은 헤더 한 행을 뺀 높이에 들어가는 수다. 열은 pane 폭에서 여백과
 * 스크롤바를 뺀 폭에 들어가는 수다. columns 보기에서는 이 수와 cell 의 pane 열 수(`cols`) 가운데 큰 쪽이다. pane 하나의
 * 폭은 `cols` 로 만든 폭이라 `cols` 가 되고, pane 여럿의 폭에 걸친 pane 만 더 많은 열을 받는다. 글자 칸 크기를 모르면
 * `undefined` 다.
 */
function terminalSize(b: Box, cell: Size, cols: ColumnCols): TerminalSize | undefined {
  if (cell.width <= 0 || cell.height <= 0) return undefined
  const rows = Math.max(0, Math.floor(b.height / cell.height - 1 + EPSILON))
  const fit = fitCols(b.width, cell.width)
  return { cols: cols === undefined ? fit : Math.max(cols, fit), rows }
}

function unitOf(cell: Size, cols: ColumnCols): Size {
  return cols === undefined ? cell : { ...cell, width: columnWidth(cols, cell.width) }
}

function placements(layout: Layout, size: Size | undefined, cell: Size, cols: ColumnCols) {
  const widths: Widths = cols === undefined ? 'half' : 'columns'
  // 영역을 재기 전의 첫 렌더는 비율로 그린다. 터미널은 열·행 수를 받을 때까지 pty 를 열지 않는다.
  if (!size)
    return new Map(
      [...rects(layout, widths)].map(([pane, r]) => [
        pane,
        placement({ left: r.x * 100, top: r.y * 100, width: r.w * 100, height: r.h * 100 }, '%')
      ])
    )
  return new Map(
    [...snapRects(layout, size, unitOf(cell, cols), widths, paneMin(cell, cols))].map(
      ([pane, b]) => [pane, placement(b, 'px', terminalSize(b, cell, cols))]
    )
  )
}

// columns 보기에서는 pane 하나의 폭을 폭의 하한으로 둔다. `layout.column-cols` 와 ⇧⌘. / ⇧⌘, 로 바꾼 값은
// `PANE_MIN.cols` 이상이므로 이 하한이 `PANE_MIN` 도 지킨다.
function paneMin(cell: Size, cols: ColumnCols): Size {
  return {
    width:
      cols === undefined
        ? paneCells(PANE_MIN.cols, cell.width) * cell.width
        : columnWidth(cols, cell.width),
    height: (PANE_MIN.rows + 1) * cell.height
  }
}

function columnColsOf(c: Pick<Cell, 'paneCols'>): ColumnCols {
  return viewMode.value === 'columns' ? paneColsOf(c) : undefined
}

function columnsWidthOf(layout: Layout, cols: ColumnCols, cell: Size): number | undefined {
  if (cols === undefined) return undefined
  return columnCount(layout) * columnWidth(cols, cell.width)
}

function areaOf(layout: Layout, cols: ColumnCols, cell: Size, measured: Size): Size {
  return {
    width: columnsWidthOf(layout, cols, cell) ?? measured.width,
    height: measured.height
  }
}

function roomFor(from: number, direction: SplitDirection, full: boolean): boolean {
  const c = workspaces.owner(from)
  if (!c) return true
  const cell = cellOf(fontOf(c))
  const measured = gridOf(c.key, cell)
  if (!measured) return true
  const next = full ? splitRoot(c.layout, -1, direction) : splitPane(c.layout, from, -1, direction)
  const cols = columnColsOf(c)
  const area = (layout: Layout): Size => areaOf(layout, cols, cell, measured)
  return canSplit(c.layout, area(c.layout), next, area(next), paneMin(cell, cols))
}

function splitSelected(direction: SplitDirection): void {
  const c = workspaces.selected()
  if (!c) return
  if (!roomFor(c.focused, direction, false)) {
    return toasts.put('split', {
      level: 'warning',
      title: 'No space for a new pane',
      lines: [`Each pane keeps at least ${PANE_MIN.cols} columns and ${PANE_MIN.rows} rows.`]
    })
  }
  toasts.close('split')
  workspaces.split(direction)
}

const views = computed(() =>
  workspaces.cells().map((c) => {
    const selected = c.key === workspaces.selectedKey.value
    const font = fontOf(c)
    const cell = cellOf(font)
    const measured = gridOf(c.key, cell)
    const cols = columnColsOf(c)
    const width = columnsWidthOf(c.layout, cols, cell)
    const places = placements(
      c.layout,
      measured && areaOf(c.layout, cols, cell, measured),
      cell,
      cols
    )
    return {
      c,
      selected,
      font,
      vars: gridVars(cell, font),
      width: width === undefined ? undefined : `${width}px`,
      panes: c.panes.map((p) => ({
        p,
        active: selected && p.key === c.focused,
        ...places.get(p.key)!
      }))
    }
  })
)

// 스크롤 watch 가 views 를 지켜보므로, pane 의 cwd·branch 가 바뀔 때마다 스크롤이 돌지 않게 views 밖에 둔다.
const labels = computed(
  () => new Map(workspaces.cells().map((c) => [c.key, cellLabel(focusedPane(c))]))
)

const URGENCY = ['blocked', 'error', 'done', 'working', 'idle'] as const

// workspace 와 cell 의 key 는 겹치지 않으므로 한 표에 둔다. workspace 의 값은 그 cell 들 가운데 가장 급한 것이다.
const urgent = computed(() => {
  const map = new Map<number, (typeof URGENCY)[number]>()
  for (const w of workspaces.list.value) {
    const all = new Set<string | undefined>()
    for (const c of w.cells) {
      const states = new Set(c.panes.map((p) => ptyStates.state(p.ptyId)))
      const state = URGENCY.find((s) => states.has(s))
      if (state) map.set(c.key, state)
      all.add(state)
    }
    const state = URGENCY.find((s) => all.has(s))
    if (state) map.set(w.key, state)
  }
  return map
})

// 왼쪽 여백과 아래에 남는 한 행 미만의 자리는 xterm 요소 밖이라, 눌러도 xterm 이 포커스를 주지 않는다.
function focusFromBody(e: MouseEvent, pane: number): void {
  if ((e.target as Element).closest('.xterm')) return
  e.preventDefault()
  terminals.get(pane)?.focus()
}

// columns 에서는 다른 cell 의 pane 도 보여 눌러 포커스를 줄 수 있으므로, 그 cell 을 선택한다.
// 포커스가 같은 pane 으로 돌아올 때도 불려, 여기서 pane 을 다시 보이면 스크롤해 둔 자리를 잃는다.
function focusPane(cell: number, pane: number): void {
  workspaces.focusPane(pane)
  workspaces.select(cell)
}

function selectPane(cell: number, pane: number): void {
  workspaces.focusPane(pane)
  selectCell(cell)
}

// 순서가 바뀌면 Vue 가 터미널의 DOM 을 옮기고, 옮겨진 터미널은 포커스를 잃는다.
function moveCell(cell: number, to: { workspace: number; index: number } | 'new'): void {
  workspaces.moveCell(cell, to)
  void focusSelected()
}

function moveWorkspace(workspace: number, index: number): void {
  workspaces.moveWorkspace(workspace, index)
  void focusSelected()
}

const appTitle = document.title
watchEffect(() => {
  const c = workspaces.selected()
  const p = c && focusedPane(c)
  document.title = p ? windowTitle(cellLabel(p)) : appTitle
  window.maru.setWindowPath(p?.cwd ?? '')
})

// cell 이 화면보다 넓을 수 있어, cell 이 아니라 포커스된 pane 이 보이게 한다.
function revealFocused(): void {
  // 터미널 요소는 왼쪽 여백만큼 pane 안쪽에 있으므로, 여백까지 보이도록 pane 을 `scrollIntoView` 한다.
  if (viewMode.value === 'columns')
    focusedTerminal()?.$el.closest('.pane')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
// 포커스가 그대로여도 앞의 cell 이 닫히거나 폭이 바뀌면 pane 이 밀려나 views 도 지켜본다.
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
  'new-cell': newCell,
  'split-right': () => splitSelected('right'),
  'split-down': () => splitSelected('down'),
  'close-pane': () => void closePane(),
  'close-workspace': () => void closeWorkspace(),
  'next-cell': () => stepCell(1),
  'previous-cell': () => stepCell(-1),
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
  'widen-cell': () => stepWidth(1),
  'narrow-cell': () => stepWidth(-1),
  'clear-scrollback': () => focusedTerminal()?.clearScrollback(),
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

// 지금 있는 workspace 의 key 만 남긴다. 재시작한 앱은 복원한 key 가운데 가장 큰 값 다음부터 key 를 매기므로, 닫은
// workspace 의 key 가 접힌 목록에 남으면 새로 연 workspace 가 그 key 를 받아 접힌 채 뜬다.
function openFolded(): number[] {
  return workspaces.list.value.map((w) => w.key).filter((k) => folded.has(k))
}

function screen(): ScreenState {
  return {
    version: SCREEN_VERSION,
    ...workspaces.snapshot(),
    sidebar: { open: sidebarOpen.value, width: sidebarWidth.value, folded: openFolded() },
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
  // 되살린 터미널이 `pty:open` 을 보낸 다음 tick 에 부른다(docs/architecture.md 의 "pane 요청은 창이 준비된 뒤에 넘긴다").
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
      :style="{ width: `${sidebarOpen ? sidebarWidth : RAIL_WIDTH}px` }"
    >
      <WorkspaceSidebar
        :collapsed="!sidebarOpen"
        :workspaces="workspaces.list.value"
        :selected-key="workspaces.selectedKey.value"
        :root="ptyStates.root"
        :command="ptyStates.command"
        :urgent="urgent"
        :folded="folded"
        :jobs="jobs"
        :now="now"
        :home="home"
        :shell="shell"
        @focus="selectPane"
        @fold="toggleFold"
        @kill-job="killJob"
        @move-cell="moveCell"
        @move-workspace="moveWorkspace"
      />
    </div>
    <div v-if="sidebarOpen" class="resizer" @mousedown.prevent @pointerdown="resizeSidebar" />
    <div class="terminals" :class="viewMode" @wheel.capture="keepHorizontalScroll">
      <div
        v-for="{ c, selected, width, font, vars, panes } in views"
        :key="c.key"
        :ref="(el) => observePanes(c.key, el)"
        class="panes"
        :class="{ selected }"
        :style="{ width, ...vars }"
      >
        <div
          class="row-bar cell-header"
          :class="[urgent.get(c.key), { focused: selected }]"
          @mousedown.prevent="selectCell(c.key)"
        >
          <span class="row-bar-icon status-icon"
            ><StatusIcon v-if="urgent.has(c.key)" :state="urgent.get(c.key)!"
          /></span>
          <span class="row-bar-text name">{{ labels.get(c.key)!.name }}</span>
          <span v-if="labels.get(c.key)!.branch" class="row-bar-text branch">{{
            labels.get(c.key)!.branch
          }}</span>
        </div>
        <div class="grid">
          <div
            v-for="{ p, active, style, size, edge } in panes"
            :key="p.key"
            class="pane"
            :class="{ 'edge-left': edge, focused: active }"
            :style="style"
            @focusin="focusPane(c.key, p.key)"
          >
            <PaneHeader
              :status="ptyStates.root(p.ptyId)"
              :command="ptyStates.command(p.ptyId)"
              :pane="p"
              :focused="active"
              :now="ptyStates.command(p.ptyId)?.running ? now : 0"
              :shell="shell"
              @mousedown.prevent="terminals.get(p.key)?.focus()"
            />
            <div class="body" @mousedown="(e) => focusFromBody(e, p.key)">
              <TerminalView
                :ref="(t) => setTerminal(p.key, t)"
                :pty-id="p.ptyId"
                :cell-id="c.id"
                :start-dir="p.startDir"
                :command="p.command"
                :attach="p.attach"
                :active="active"
                :shown="selected || viewMode === 'columns'"
                :font="font"
                :theme="terminalTheme"
                :cols="size?.cols"
                :rows="size?.rows"
                @exit="removePane(p.key)"
                @failed="(message) => paneFailed(p.key, message)"
                @spawned="(dir) => onSpawned(p.key, p.ptyId, dir)"
                @program-status="(records) => onLegacyProgramStatus(p.ptyId, records)"
                @link-failed="linkFailed"
                @cell="(cell) => setCell(fontOf(c), cell)"
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
  /* cell 사이는 행을 이어 쓸 필요가 없어 틈을 두고 카드로 나눈다. */
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

.cell-header {
  box-shadow: inset 0 -1px 0 var(--line);
}

.header-bottom .cell-header {
  order: 1;
  box-shadow: inset 0 1px 0 var(--line);
}

.cell-header .name {
  font-weight: bold;
}

.cell-header .branch {
  color: var(--faint);
}

.pane {
  position: absolute;
  /* 다른 클라이언트가 primary 면 터미널은 그 클라이언트의 열·행 수를 따르므로, pane 보다 넓으면 옆 pane 과 패널을 덮는다.
     hidden 이면 pane 이 스크롤 영역이 되어, pane 보다 큰 터미널을 scrollIntoView 할 때 헤더가 밀려 올라간다. */
  overflow: clip;
  background: var(--ground);
}

/* 좌우 pane 의 경계선. 자리를 차지하지 않게 겹친다 — docs/architecture.md 의 "pane 경계와 글자 칸 격자". */
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

.pane-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
}

/* 터미널은 받은 열·행 수만큼만 그리므로, 본문 오른쪽과 아래에 한 글자 칸 미만의 빈 자리가 남을 수 있다. */
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
