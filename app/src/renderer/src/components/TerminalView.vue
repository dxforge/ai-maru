<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type IRenderDimensions } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import { attach, type Attachment } from '../session/attach'
import { openSession, type SessionConnection } from '../session/connection'
import { isAppKey, matchesKeys, menuKeys, terminalInput } from '../../../shared/shortcuts'
import { osc7Path } from '../workspace/cwd'

const { startDir = undefined, active } = defineProps<{ startDir?: string; active: boolean }>()
const emit = defineEmits<{
  exit: []
  cwd: [cwd: string]
  spawned: [id: string]
  cellWidth: [width: number]
}>()

const host = useTemplateRef<HTMLDivElement>('host')
const term = new Terminal({
  theme: { background: '#1e1e1e' },
  // Claude Code 의 ⌥P(모델 전환)·⌥B/⌥F(단어 이동) 같은 키는 ⌥ 가 Meta 로 가야 동작한다.
  // 대신 ⌥ 로 치는 글자(™, 유럽 자판의 `@`·`{` 등)는 터미널에 칠 수 없다.
  macOptionIsMeta: true,
  // 켜지 않으면 ⇧↩ 이 ↩ 과 같은 CR 로 가서, Claude Code 가 줄을 바꾸는 대신 입력을 제출해 버린다.
  vtExtensions: { kittyKeyboard: true }
})
const fit = new FitAddon()
term.loadAddon(fit)
const selectAllKeys = menuKeys('selectAll')!
term.attachCustomKeyEventHandler((e) => {
  const input = terminalInput(e)
  if (input !== undefined) {
    if (e.type === 'keydown') term.input(input)
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
// css.cell.width 는 열 수마다 반올림이 달라, 열 수와 상관없는 device 값으로 셈한다.
const cellWidth = (d: IRenderDimensions): number => d.device.cell.width / devicePixelRatio
term.onDimensionsChange((d) => emit('cellWidth', cellWidth(d)))
let session: Attachment | null = null
const observer = new ResizeObserver(() => {
  if (session?.primary !== false) fit.fit()
})

let opening: Promise<SessionConnection> | undefined

defineExpose({ focus: () => term.focus(), kill: () => void opening?.then((c) => c.kill()) })

watch(
  () => active,
  (now) => now && term.focus(),
  { flush: 'post' }
)

onMounted(async () => {
  term.open(host.value!)
  if (term.dimensions) emit('cellWidth', cellWidth(term.dimensions))
  fit.fit()
  observer.observe(host.value!)
  if (active) term.focus()
  opening = openSession(startDir)
  session = attach(term, await opening, {
    onExit: () => emit('exit'),
    onSpawned: (id, dir) => {
      emit('spawned', id)
      emit('cwd', dir)
    }
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
</style>
