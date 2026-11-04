<script setup lang="ts">
import type { Component } from 'vue'
import type { CommandId } from '../../../shared/commands'
import { commandLabel } from '../../../shared/shortcuts'

export type Panel = {
  id: string
  title: string
  icon: Component
  open: boolean
  command: CommandId
}

defineProps<{ panels: readonly Panel[] }>()
defineEmits<{ run: [id: CommandId] }>()
</script>

<template>
  <nav class="panel-bar" aria-label="Panels">
    <div class="titlebar" />
    <button
      v-for="p in panels"
      :key="p.id"
      v-tooltip="{
        text: `${p.open ? 'Close' : 'Open'} ${p.title}`,
        keys: commandLabel(p.command)
      }"
      class="panel-button"
      :class="{ open: p.open }"
      :data-panel="p.id"
      :aria-label="p.title"
      :aria-pressed="p.open"
      @mousedown.prevent
      @click="$emit('run', p.command)"
    >
      <component :is="p.icon" :size="18" />
    </button>
  </nav>
</template>

<style scoped>
.panel-bar {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  width: 36px;
  border-left: 1px solid var(--line);
  background: var(--side);
}

.titlebar {
  flex: none;
  align-self: stretch;
  height: var(--titlebar-height);
  margin-bottom: var(--space-3);
  border-bottom: 1px solid var(--line);
  -webkit-app-region: drag;
}

.panel-button {
  -webkit-app-region: no-drag;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--radius-2);
  background: none;
  color: var(--muted);
  cursor: pointer;
}

.panel-button:hover {
  color: var(--fg);
  background: var(--hover);
}

.panel-button.open {
  color: var(--accent);
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 50%, transparent);
}
</style>
