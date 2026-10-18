<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type IRenderDimensions } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import { attach as attachTerminal, type Attachment } from '../session/attach'
import { openSession, type SessionConnection } from '../session/connection'
import { isAppKey, matchesKeys, menuKeys, terminalInput } from '../../../shared/shortcuts'
import { FONT_FAMILY, FONT_SIZE } from '../font'
import { SCROLLBAR_WIDTH } from '../workspace/columns'
import { osc7Path } from '../workspace/cwd'
import type { Size } from '../workspace/grid'
import { GHOSTTY, xtermTheme } from '../../../shared/theme'

const {
  sessionId,
  workspaceId,
  startDir = undefined,
  command = undefined,
  attach = undefined,
  active
} = defineProps<{
  sessionId: string
  workspaceId: string
  startDir?: string
  command?: readonly string[]
  attach?: boolean
  active: boolean
}>()
const emit = defineEmits<{
  exit: []
  failed: [message: string]
  cwd: [cwd: string]
  spawned: []
  title: [title: string]
  cell: [cell: Size]
}>()

const host = useTemplateRef<HTMLDivElement>('host')
const term = new Terminal({
  theme: xtermTheme(GHOSTTY),
  fontFamily: FONT_FAMILY,
  fontSize: FONT_SIZE,
  lineHeight: 1.2,
  scrollbar: { width: SCROLLBAR_WIDTH },
  // Claude Code 의 ⌥P(모델 전환)·⌥B/⌥F(단어 이동) 같은 키는 ⌥ 가 Meta 로 가야 동작한다.
  // 대신 ⌥ 로 치는 글자(™, 유럽 자판의 `@`·`{` 등)는 터미널에 칠 수 없다.
  macOptionIsMeta: true,
  // 켜지 않으면 ⇧↩ 이 ↩ 과 같은 CR 로 가서, Claude Code 가 줄을 바꾸는 대신 입력을 제출해 버린다.
  vtExtensions: { kittyKeyboard: true }
})
const fit = new FitAddon()
term.loadAddon(fit)
const selectAllKeys = menuKeys('selectAll')!
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
  // xterm 은 ⌃⌘↩ 같은 키도, kitty 키보드 모드에서는 ⌘C 같은 키도 프로그램에 보내며
  // preventDefault 하므로, 그대로 두면 메뉴에 닿지 않는다.
  if (!isAppKey(e)) return true
  // 메뉴의 Select All 은 포커스된 입력창(xterm 의 숨은 textarea)의 글자만 골라 터미널 내용은 고르지 않는다.
  if (e.type === 'keydown' && matchesKeys(e, selectAllKeys)) term.selectAll()
  return false
})
term.parser.registerOscHandler(7, (data) => {
  const path = osc7Path(data)
  if (path) emit('cwd', path)
  return true
})
term.onTitleChange((title) => emit('title', title))
// css.cell 은 열·행 수마다 반올림이 달라, 그와 상관없는 device 값으로 계산한다.
const cell = (d: IRenderDimensions): Size => ({
  width: d.device.cell.width / devicePixelRatio,
  height: d.device.cell.height / devicePixelRatio
})
term.onDimensionsChange((d) => emit('cell', cell(d)))
let session: Attachment | null = null
const observer = new ResizeObserver(() => {
  if (session?.primary !== false) fit.fit()
})

let conn: SessionConnection | undefined

defineExpose({ focus: () => term.focus(), kill: () => conn?.kill() })

watch(
  () => active,
  (now) => now && term.focus(),
  { flush: 'post' }
)

onMounted(() => {
  term.open(host.value!)
  trackComposition(term.textarea!)
  if (term.dimensions) emit('cell', cell(term.dimensions))
  fit.fit()
  observer.observe(host.value!)
  if (active) term.focus()
  // reactive 배열의 proxy 는 IPC 로 보낼 수 없다.
  conn = openSession({
    id: sessionId,
    workspace: workspaceId,
    cwd: startDir,
    command: command && [...command],
    attach
  })
  session = attachTerminal(term, conn, {
    onExit: () => emit('exit'),
    onOpenFailed: (message) => emit('failed', message),
    onSpawned: (_id, dir) => {
      emit('spawned')
      if (dir !== undefined) emit('cwd', dir)
    }
  })
  // 조합한 글자는 다음 키가 오면 그 키보다 먼저 setTimeout 을 기다리지 않고 간다. 그 바로 뒤에 보낸다.
  // 세션에 보내는 attach 의 listener 보다 뒤에 걸어야 미룬 키가 조합한 글자 뒤로 간다.
  term.onData(() => {
    if (!composing) flushAfterComposition()
  })
})

onBeforeUnmount(() => {
  observer.disconnect()
  term.dispose()
})
</script>

<template>
  <div ref="host" class="terminal-view" :class="{ active }" />
</template>

<style scoped>
.terminal-view {
  position: absolute;
  inset: 0;
}

/* xterm 의 스크롤바(z-index 11)가 칸을 흐리게 덮는 층(App.vue) 위로 올라오지 않게 쌓임 맥락을 따로 둔다. */
.terminal-view {
  isolation: isolate;
}

.terminal-view :deep(.xterm) {
  padding-left: var(--pad);
}

/* xterm.css 가 viewport 를 검게 칠하는데, viewport 는 여백까지 덮고 테마 배경은 그 안쪽에만 칠해진다.
   투명하게 두어 여백에도 .xterm 의 테마 배경이 보이게 한다. */
.terminal-view :deep(.xterm .xterm-viewport) {
  background-color: transparent;
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
