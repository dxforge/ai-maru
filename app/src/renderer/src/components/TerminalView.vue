<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import { attach, type Attachment } from '../session/attach'
import { openSession } from '../session/connection'
import { osc7Path } from '../workspace/cwd'

const {
  sessionId = undefined,
  startDir = undefined,
  active
} = defineProps<{ sessionId?: string; startDir?: string; active: boolean }>()
const emit = defineEmits<{ exit: []; cwd: [cwd: string] }>()

const host = useTemplateRef<HTMLDivElement>('host')
const term = new Terminal({ theme: { background: '#1e1e1e' } })
const fit = new FitAddon()
term.loadAddon(fit)
term.parser.registerOscHandler(7, (data) => {
  const path = osc7Path(data)
  if (path) emit('cwd', path)
  return true
})
let session: Attachment | null = null
const observer = new ResizeObserver(() => {
  if (session?.primary !== false) fit.fit()
})

defineExpose({ focus: () => term.focus() })

watch(
  () => active,
  (now) => now && term.focus(),
  { flush: 'post' }
)

onMounted(async () => {
  term.open(host.value!)
  fit.fit()
  observer.observe(host.value!)
  if (active) term.focus()
  session = attach(term, await openSession(sessionId, startDir), {
    onExit: () => emit('exit'),
    onSpawned: (dir) => emit('cwd', dir)
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
/* 보이지 않는 터미널도 자리를 차지해야 창 크기를 따라가고, 보일 때 다시 맞추지 않아도 된다. */
.terminal-view {
  position: absolute;
  inset: 0;
  visibility: hidden;
}

.terminal-view.active {
  visibility: visible;
}
</style>
