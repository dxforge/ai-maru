<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type IRenderDimensions } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import { attach, type Attachment } from '../session/attach'
import { openSession, type SessionConnection } from '../session/connection'
import { osc7Path } from '../workspace/cwd'

const {
  sessionId = undefined,
  startDir = undefined,
  active
} = defineProps<{ sessionId?: string; startDir?: string; active: boolean }>()
const emit = defineEmits<{
  exit: []
  cwd: [cwd: string]
  spawned: [id: string]
  cellWidth: [width: number]
}>()

const host = useTemplateRef<HTMLDivElement>('host')
const term = new Terminal({ theme: { background: '#1e1e1e' } })
const fit = new FitAddon()
term.loadAddon(fit)
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
  opening = openSession(sessionId, startDir)
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
