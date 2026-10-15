<script setup lang="ts">
import type { ClaudeState } from '../../../shared/claude'
import { ICONS } from '../icons'
import { workspaceName } from '../workspace/cwd'

const {
  state = undefined,
  title = undefined,
  cwd = undefined,
  focused
} = defineProps<{ state?: ClaudeState; title?: string; cwd?: string; focused: boolean }>()
</script>

<template>
  <div class="bar pane-header" :class="[state, { focused }]">
    <span class="bar-icon" :title="state && `Claude: ${state}`">{{
      state ? ICONS[state] : ICONS.terminal
    }}</span>
    <span class="title">{{ title || 'Shell' }}</span>
    <span v-if="state" class="app">{{ ICONS.claude }}</span>
    <span v-if="cwd" class="cwd">{{ workspaceName(cwd) }}</span>
  </div>
</template>

<style scoped>
.pane-header.waiting {
  background: var(--hdr-waiting);
}

.pane-header.waiting.focused {
  background: var(--hdr-waiting-focus);
}

.idle .bar-icon {
  font-size: 9px;
}

.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app {
  color: var(--faint);
  font-family: 'Maru Symbols';
}

.cwd {
  color: var(--faint);
}
</style>
