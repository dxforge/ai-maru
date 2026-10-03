<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue'

const host = useTemplateRef<HTMLDivElement>('host')
const term = new Terminal({ theme: { background: '#1e1e1e' } })
const fit = new FitAddon()
term.loadAddon(fit)
const observer = new ResizeObserver(() => fit.fit())

onMounted(() => {
  term.open(host.value!)
  observer.observe(host.value!)
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
