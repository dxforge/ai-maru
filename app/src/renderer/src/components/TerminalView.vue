<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue'
import { attach } from '../session/attach'
import { openSession } from '../session/connection'

const host = useTemplateRef<HTMLDivElement>('host')
const term = new Terminal({ theme: { background: '#1e1e1e' } })
const fit = new FitAddon()
term.loadAddon(fit)
let primary = true
const observer = new ResizeObserver(() => {
  if (primary) fit.fit()
})

onMounted(async () => {
  term.open(host.value!)
  fit.fit()
  observer.observe(host.value!)
  term.focus()
  attach(term, await openSession(), {
    onExit: () => window.close(),
    onDemoted: () => (primary = false)
  })
})

onBeforeUnmount(() => {
  observer.disconnect()
  term.dispose()
})
</script>

<template>
  <div ref="host" class="terminal-view" />
</template>

<style scoped>
.terminal-view {
  height: 100%;
}
</style>
