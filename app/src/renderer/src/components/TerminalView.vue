<script lang="ts">
import { shallowRef } from 'vue'
import { trackMetaKey } from '../terminal/links'

// 창 안의 어느 터미널도 WebGL addon 을 적용한 적이 없을 때 적용에 실패하면 켠다. 그동안은 renderer 가
// 바뀔 일이 없으므로 모든 터미널이 DOM 의 글자 칸 폭으로 열 수를 센다.
const webglUnavailable = shallowRef(false)
let webglLoaded = false
const metaKey = trackMetaKey(window)
const metaPressed = shallowRef(metaKey.pressed)
metaKey.onChange((pressed) => (metaPressed.value = pressed))
</script>

<script setup lang="ts">
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal, type IRenderDimensions, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { attach as attachTerminal, type Attachment } from '../pty/attach'
import { openPty, type PtyConnection } from '../pty/connection'
import type { ProgramStatusRecord } from '../../../shared/program-status'
import { exitMessage, failedExit } from '../../../shared/pty'
import { isSelectAll, terminalInput } from '../../../shared/shortcuts'
import { sameFont, type TerminalFont } from '../config/terminal'
import { alignComposition } from '../terminal/composition'
import { createLinkHandler, registerLinkProvider } from '../terminal/links'
import { pastePaths } from '../terminal/paths'
import { SCROLLBAR_WIDTH } from '../workspace/columns'
import type { Size } from '../workspace/grid'

const {
  ptyId,
  cellId,
  startDir = undefined,
  command = undefined,
  attach = undefined,
  keep = undefined,
  active,
  shown,
  font,
  theme,
  cols = undefined,
  rows = undefined
} = defineProps<{
  ptyId: string
  cellId: string
  startDir?: string
  command?: readonly string[]
  attach?: boolean
  /** pty 를 `--keep` 으로 띄우고, 명령이 실패하면 `exit` 를 내지 않고 종료 상태를 마지막 줄에 쓴다. */
  keep?: boolean
  active: boolean
  /** 터미널이 속한 cell 이 화면에 나와 있다. 겹쳐 숨은 cell 도 화면 안에 있어 IntersectionObserver 로는 가려낼 수 없다. */
  shown: boolean
  font: TerminalFont
  theme: ITheme
  /** `App` 이 pane 배치와 함께 정한 열 수. 처음 받은 열·행 수로 pty 에 붙고, 그 뒤에는 primary 일 때만 이 값으로 크기를 바꾼다. */
  cols?: number
  /** `App` 이 pane 배치와 함께 정한 행 수. */
  rows?: number
}>()
const emit = defineEmits<{
  exit: []
  /** 되살린 pane 의 pty 가 없어 같은 자리에 새 셸이 뜬다. */
  gone: []
  failed: [message: string]
  /** `cwd` 는 pty 를 띄운 실제 시작 디렉토리다. 되살린 pane 이 남은 pty 에 붙으면 없다. */
  spawned: [cwd: string | undefined]
  /** 이전 maru-pty 의 pty 만 attach 스트림으로 보내는 OSC 7501 레코드(`pty/states.ts`). */
  programStatus: [records: ProgramStatusRecord[]]
  linkFailed: [reason: string]
  cell: [cell: Size]
}>()

const host = useTemplateRef<HTMLDivElement>('host')
const term = new Terminal({
  theme,
  ...font,
  scrollbar: { width: SCROLLBAR_WIDTH },
  // Claude Code 의 ⌥P(모델 전환)·⌥B/⌥F(단어 이동) 같은 키는 ⌥ 가 Meta 로 가야 동작한다.
  // 대신 ⌥ 로 치는 글자(™, 유럽 자판의 `@`·`{` 등)는 터미널에 칠 수 없다.
  macOptionIsMeta: true,
  // 켜지 않으면 ⇧↩ 이 ↩ 과 같은 CR 로 가서, Claude Code 가 줄을 바꾸는 대신 입력을 제출해 버린다.
  vtExtensions: { kittyKeyboard: true },
  // `UnicodeGraphemesAddon` 이 쓰는 `term.unicode` 가 proposed API 라서, 끄면 `loadAddon` 이 예외를 던진다.
  allowProposedApi: true
})
// 이 addon 을 빼거나 바꾸면 `maru-pty` 와 글자 폭이 달라진다(`docs/architecture.md` 의 "글자 폭").
term.loadAddon(new UnicodeGraphemesAddon())
// 링크는 ⌘+클릭으로만 연다(Terminal.app·iTerm2 의 관행). 그냥 클릭은 터미널로 간다.
function activateLink(event: MouseEvent, text: string): void {
  if (!event.metaKey) return
  void window.maru.openLink(text, ptyId).then((r) => {
    if (!r.ok) emit('linkFailed', r.reason)
  })
}
// OSC 8 링크는 라벨이 주소를 가리므로(`#12` → 이슈 주소), ⌘ 를 누른 채 hover 하는 동안 주소를 보인다. 글자로 찍힌
// 링크는 글자가 곧 주소라 따로 보이지 않는다.
const hoveredUrl = ref<string | null>(null)
term.options.linkHandler = createLinkHandler(activateLink, (url) => (hoveredUrl.value = url))
const textLinks = registerLinkProvider(term, metaKey, activateLink, (paths) =>
  window.maru.longestExistingPaths(paths, ptyId)
)
const MODIFIERS = new Set(['Meta', 'Shift', 'Alt', 'Control'])
// xterm 은 조합한 글자를 compositionend 다음 setTimeout(0) 에 보내고, 아래 handler 가 false 를 내면
// 조합을 먼저 끝내지도 않는다. 그 사이에 보낸 키는 조합한 글자보다 앞서 가므로, 조합한 글자가 간 뒤로 미룬다.
let composing = false
let afterComposition: string[] | undefined
function flushAfterComposition(): void {
  const queued = afterComposition ?? []
  afterComposition = undefined
  for (const input of queued) term.input(input)
}
function sendInput(input: string): void {
  if (composing || afterComposition) (afterComposition ??= []).push(input)
  else term.input(input)
}
function trackComposition(textarea: HTMLTextAreaElement): void {
  textarea.addEventListener('compositionstart', () => (composing = true))
  textarea.addEventListener('compositionend', () => {
    composing = false
    afterComposition ??= []
    // 조합한 글자가 비어 xterm 이 아무것도 보내지 않을 때. xterm 의 listener 보다 뒤에 걸려 그 setTimeout 보다 뒤에 돈다.
    setTimeout(flushAfterComposition)
  })
}
term.attachCustomKeyEventHandler((e) => {
  const input = terminalInput(e)
  if (input !== undefined) {
    if (e.type === 'keydown') sendInput(input)
    e.preventDefault()
    return false
  }
  // ⌘ 조합은 앱이 가진다. kitty 키보드 모드에서 xterm 은 ⌘ 조합도 프로그램에 보내며 preventDefault 하므로,
  // 그대로 두면 메뉴에 닿지 않는다. 메뉴는 글자로 맞추므로 표(`shortcuts.ts`, 자판 위치)로는 가려낼 수 없다.
  // modifier 만 누른 것은 메뉴가 받지 않으므로 xterm 에 준다 — kitty 모드 프로그램은 modifier 의 누름·뗌도 받는다.
  if (!e.metaKey || MODIFIERS.has(e.key)) return true
  // 메뉴의 Select All 은 포커스된 입력창(xterm 의 숨은 textarea)의 글자만 골라 터미널 내용은 고르지 않는다.
  if (e.type === 'keydown' && isSelectAll(e)) term.selectAll()
  return false
})
// css.cell 은 열·행 수마다 반올림이 달라, 그와 상관없는 device 값으로 계산한다.
// WebGL renderer 는 글자 칸 폭을 device px 로 내림한다. DOM 으로 그리는 동안에도 그 폭을 써서, renderer 가
// 바뀔 때 열 수가 바뀌어 프로그램에 resize 가 가지 않게 한다. 대신 DOM 으로 그리면 pane 보다 넓어져 오른쪽
// 몇 열이 잘린다.
const floorCell = (): boolean => window.maru.webgl && !webglUnavailable.value
const cell = (d: IRenderDimensions): Size => ({
  width: (floorCell() ? Math.floor(d.device.cell.width) : d.device.cell.width) / devicePixelRatio,
  height: d.device.cell.height / devicePixelRatio
})
let lastCell: Size | undefined
/**
 * 창을 DPR 이 다른 화면으로 옮기거나 글꼴 설정이 바뀌면 글자 칸 크기가 바뀐다. 이 함수가 `App` 에 알리면 `App` 이 새 글자 칸
 * 크기로 pane 배치와 열·행 수를 다시 정해 `cols`·`rows` 로 넘긴다.
 */
function checkCell(force = false): void {
  if (!term.dimensions) return
  const c = cell(term.dimensions)
  if (!force && lastCell && c.width === lastCell.width && c.height === lastCell.height) return
  lastCell = c
  emit('cell', c)
}
term.onDimensionsChange(() => checkCell())
// xterm 6 은 resize 뒤 스크롤바의 위치를 buffer 가 보이는 줄에 다시 맞추지 않는다(xtermjs/xterm.js#6172). 휠을 굴린 뒤
// 행 수가 줄면 다음 휠이 줄어든 행 수만큼 위로 튀므로, resize 뒤에 위치를 맞춘다. upstream 이 고치면 지운다.
type XtermViewport = {
  queueSync?(): void
  scrollToLine?(line: number, disableSmoothScroll?: boolean): void
}
let resyncPending = false
let resyncFrame: number | undefined
// 스크롤 범위가 옛 행 수로 남은 동안 위치를 맞추면 buffer 가 그 범위 안으로 잘린 위치로 끌려간다. 화면 밖이라 그리기를
// 멈춘 터미널에서는 xterm 이 렌더러의 크기 계산을 `requestIdleCallback` 이 돌 때나 터미널이 다시 보일 때 가운데 먼저 오는
// 때로 미룬다. 프로그램이 synchronized output 을 켠 동안에는 xterm 이 스크롤 범위를 다시 정하는 것을 synchronized output 이
// 끝난 뒤 그릴 때로 미룬다.
function canResync(): boolean {
  const d = term.dimensions
  return (
    !!d &&
    d.device.canvas.height === d.device.cell.height * term.rows &&
    !term.modes.synchronizedOutputMode
  )
}
function resyncScroll(): void {
  if (!resyncPending || resyncFrame !== undefined || !canResync()) return
  const viewport = (term as unknown as { _core?: { _viewport?: XtermViewport } })._core?._viewport
  // `queueSync` 가 다음 프레임에 스크롤 범위를 지금 행 수로 다시 정하므로, 위치는 그 뒤에 rAF 로 맞춘다.
  viewport?.queueSync?.()
  resyncFrame = requestAnimationFrame(() => {
    resyncFrame = undefined
    if (!canResync()) return
    resyncPending = false
    viewport?.scrollToLine?.(term.buffer.active.viewportY, true)
  })
}
term.onResize(() => {
  resyncPending = true
  // xterm 은 이 listener 가 돈 뒤에 렌더러의 크기를 새 행 수로 바꾼다.
  queueMicrotask(resyncScroll)
})
// xterm 은 미뤄 둔 크기 계산과 스크롤 범위를 다시 그릴 때 새 행 수로 바꾸므로, 그릴 때마다 위치 맞추기를 다시 시도한다.
term.onRender(resyncScroll)
let pty: Attachment | null = null
let started = false
// pty 는 붙을 때의 크기로 행마다 개행을 넣어 재생하므로, 뒤에 넓혀도 펼쳐지지 않는다. 그래서 `App` 이 열·행 수를 정한 뒤에 붙는다.
function applySize(): void {
  if (cols === undefined || rows === undefined || !pty) return
  if (started && !pty.primary) return
  term.resize(cols, rows)
  if (started) return
  started = true
  pty.start()
}
watch([() => cols, () => rows], applySize)

// Chromium 이 동시에 유지하는 WebGL context 는 16개뿐이라, 보이는 터미널만 WebGL 로 그리고 나머지는 DOM 으로 둔다.
let webgl: WebglAddon | undefined
let inView = false
// context 를 잃은 원인(한도 초과·GPU 리셋)이 남아 있으면 다시 적용해도 또 잃으므로, 한 번 숨었다 보일 때까지 기다린다.
let lost = false
// `@xterm/addon-webgl` 은 링크 레이어 캔버스에 `xterm-<id>-layer` class 를 붙인다. 그 class 가 없는 캔버스가 WebGL renderer 의 것이다.
const webglCanvas = (): HTMLCanvasElement | undefined =>
  (webgl &&
    term.element!.querySelector<HTMLCanvasElement>(
      '.xterm-screen > canvas:not([class*="-layer"])'
    )) ||
  undefined
// addon 은 dispose 해도 GC 될 때까지 context 를 해제하지 않는다. 그렇게 남은 context 가 한도를 채우면 Chromium 이
// 가장 오래된 context 를 버리고, 그것이 보이는 터미널의 것일 수 있다.
function disposeWebgl(): void {
  const canvas = webglCanvas()
  webgl!.dispose()
  webgl = undefined
  canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext()
}
function updateRenderer(): void {
  if (!(shown && inView)) lost = false
  const want = shown && inView && !lost
  if (want === (webgl !== undefined)) return
  if (!want) return disposeWebgl()
  const addon = new WebglAddon()
  addon.onContextLoss(() => {
    lost = true
    updateRenderer()
  })
  try {
    term.loadAddon(addon)
    webgl = addon
    webglLoaded = true
    webglUnavailable.value = false
  } catch {
    addon.dispose()
    lost = true
    if (!webglLoaded) webglUnavailable.value = true
  }
}
// 글자 칸 폭을 내림하는지가 바뀌어도 xterm 의 dimensions 는 그대로라 `onDimensionsChange` 가 오지 않는다.
watch(webglUnavailable, () => checkCell())
const intersection = window.maru.webgl
  ? new IntersectionObserver((entries) => {
      inView = entries[entries.length - 1].isIntersecting
      updateRenderer()
    })
  : undefined
watch(() => shown, updateRenderer)
// xterm 은 줄 높이만 바뀌면 `onDimensionsChange` 를 내지 않으므로 여기서 `checkCell` 을 부른다.
// App 은 크기를 바꾼 cell 의 글꼴을 다시 그릴 때마다 새 객체로 넘기므로 값으로 견준다.
// App 은 글꼴마다 글자 칸 크기를 두므로, 글자 칸 크기가 그대로여도 `cell` 을 내서 App 이 새 글꼴의 글자 칸 크기를 기록하게 한다.
watch(
  () => font,
  (f, old) => {
    if (sameFont(f, old)) return
    Object.assign(term.options, f)
    checkCell(true)
  }
)

watch(
  () => theme,
  (t) => (term.options.theme = t)
)

function pasteFiles(files: FileList | undefined): boolean {
  const text = pastePaths(Array.from(files ?? [], window.maru.pathForFile))
  if (!text) return false
  term.paste(text)
  return true
}
function onDragOver(e: DragEvent): void {
  if (!e.dataTransfer?.types.includes('Files')) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
}
function onDrop(e: DragEvent): void {
  if (!e.dataTransfer?.types.includes('Files')) return
  e.preventDefault()
  if (pasteFiles(e.dataTransfer.files)) term.focus()
}
// xterm 은 클립보드의 text/plain 만 붙이므로 `onPaste` 가 xterm 의 listener 보다 먼저 Finder 에서 복사한 파일을 받아 경로로 붙인다.
// 경로가 없으면 막지 않는다. 이미지만 든 클립보드에서 xterm 이 보내는 빈 bracketed paste 를 받아야 Claude Code 가
// 클립보드의 이미지를 읽기 때문이다.
function onPaste(e: ClipboardEvent): void {
  if (!pasteFiles(e.clipboardData?.files)) return
  e.preventDefault()
  e.stopPropagation()
}

let conn: PtyConnection | undefined

// claude 처럼 입력란 아래에 상태줄을 그려 두는 프로그램은 커서를 그 위에 둔 채 끝나므로, 커서 자리에 쓰면 아래 줄을 덮는다.
// 앞서 받은 출력을 xterm 이 다 그린 뒤, 화면에 그려진 마지막 줄 바로 아래로 커서를 옮겨 쓴다.
function writeBelowContent(text: string): void {
  term.write('', () => {
    const buffer = term.buffer.active
    let last = -1
    for (let y = term.rows - 1; y >= 0 && last < 0; y--)
      if (buffer.getLine(buffer.baseY + y)?.translateToString(true)) last = y
    const row = last + 2
    const move = row > term.rows ? `\x1b[${term.rows};1H\r\n` : `\x1b[${row};1H`
    term.write(`${move}${text}\r\n`)
  })
}

defineExpose({
  focus: () => term.focus(),
  kill: () => conn?.kill(),
  clearScrollback: () => pty?.clearScrollback()
})

watch(
  () => active,
  (now) => now && term.focus(),
  { flush: 'post' }
)

onMounted(() => {
  term.open(host.value!)
  trackComposition(term.textarea!)
  alignComposition(term, webglCanvas)
  checkCell()
  intersection?.observe(host.value!)
  if (active) term.focus()
  // reactive 배열의 proxy 는 IPC 로 보낼 수 없다.
  conn = openPty({
    id: ptyId,
    cell: cellId,
    cwd: startDir,
    command: command && [...command],
    attach,
    keep
  })
  pty = attachTerminal(term, conn, {
    onExit: (exit) => {
      if (keep && failedExit(exit)) writeBelowContent(exitMessage(exit))
      else emit('exit')
    },
    onGone: () => emit('gone'),
    onOpenFailed: (message) => emit('failed', message),
    onSpawned: (_id, dir) => emit('spawned', dir),
    onProgramStatus: (records) => emit('programStatus', records)
  })
  // 조합한 글자는 다음 키가 오면 그 키보다 먼저 setTimeout 을 기다리지 않고 간다. 그 바로 뒤에 보낸다.
  // pty 에 보내는 attach 의 listener 보다 뒤에 걸어야 미룬 키가 조합한 글자 뒤로 간다.
  term.onData(() => {
    if (!composing) flushAfterComposition()
  })
  applySize()
})

onBeforeUnmount(() => {
  intersection?.disconnect()
  if (resyncFrame !== undefined) cancelAnimationFrame(resyncFrame)
  textLinks.dispose()
  if (webgl) disposeWebgl()
  term.dispose()
})
</script>

<template>
  <div
    ref="host"
    class="terminal-view"
    :class="{ active }"
    @dragover="onDragOver"
    @drop="onDrop"
    @paste.capture="onPaste"
  >
    <div v-if="metaPressed && hoveredUrl" class="link-address">{{ hoveredUrl }}</div>
  </div>
</template>

<style scoped>
.terminal-view {
  position: absolute;
  inset: 0;
}

/* xterm 의 스크롤바(z-index 11)가 pane 을 흐리게 덮는 층(App.vue) 위로 올라오지 않게 쌓임 맥락을 따로 둔다. */
.terminal-view {
  isolation: isolate;
}

/* 브라우저가 링크 주소를 보이는 자리(왼쪽 아래). 스크롤바(z-index 11)보다 위에 둔다. 마우스가 닿으면 링크를
   떠난 것으로 쳐 사라지므로 마우스 이벤트를 받지 않는다. */
.link-address {
  position: absolute;
  left: 0;
  bottom: 0;
  z-index: 12;
  max-width: calc(100% - 16px);
  padding: 2px 6px;
  border: 1px solid var(--line);
  border-radius: 0 4px 0 0;
  background: var(--raised);
  color: var(--muted);
  font: 11px/1.4 system-ui;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}

.terminal-view :deep(.xterm) {
  padding-left: var(--pad);
}

/* xterm.css 가 viewport 를 검게 칠하는데, viewport 는 여백까지 덮고 테마 배경은 그 안쪽에만 칠해진다.
   투명하게 두어 여백에도 .xterm 의 테마 배경이 보이게 한다. */
.terminal-view :deep(.xterm .xterm-viewport) {
  background-color: transparent;
}

/* xterm.css 는 조합창을 검은 바탕에 흰 글자로 칠한다. 바탕은 테마 색으로 바꾸되 불투명하게 두어, 조합하는
   동안 그 아래의 커서를 가린다. */
.terminal-view :deep(.xterm .composition-view) {
  background: var(--ground);
  color: var(--fg);
  text-decoration: underline;
}

/* xterm 은 조합창을 갱신할 때마다(조합 입력과 렌더마다) inline 으로 `direction: rtl`·`overflow: hidden` 을 다시 넣으므로,
   `composition.ts` 가 `composition-fits` 를 붙인 조합창은 `!important` 로 덮는다. 조합창 폭은 글자 칸에 맞췄으므로, 글자 칸보다 넓게 그려지는
   마지막 글자는 조합창 밖으로 넘친다. 넘친 끝을 자르면 글자가 깨져 보이므로 자르지 않는다. */
.terminal-view :deep(.xterm .composition-view.composition-fits) {
  direction: ltr !important;
  overflow: visible !important;
}

/* 막대를 둥글게 스크롤바 안쪽 1px 에 그린다. 폭은 xterm 이 inline 으로 정해 투명 테두리로 줄이고, xterm 이
   막대 색을 background 단축 속성으로 넣어 background-clip 을 되돌리므로 그보다 구체적인 셀렉터로 쓴다. */
.terminal-view
  :deep(.xterm .xterm-scrollable-element > .xterm-scrollbar.xterm-vertical > .xterm-slider) {
  box-sizing: border-box;
  border: 1px solid transparent;
  border-radius: 4px;
  background-clip: padding-box;
}
</style>
